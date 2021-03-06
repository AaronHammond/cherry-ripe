
/**
 * Module dependencies.
 */

var express = require('express');
var routes = require('./routes');
var user = require('./routes/user');
var http = require('http');
var path = require('path');
var redis = require('redis');

redisClient = redis.createClient(process.env.REDISPORT || null, process.env.REDISHOST || null, {auth_pass: process.env.REDISPASS || null});
redisClient.on('error', function(err){
	console.log("Redis Error: " + err);
})
redisClient.flushdb();

var app = express();


// all environments
app.set('port', process.env.PORT || 3000);
app.set('views', path.join(__dirname, 'views'));
app.engine('html', require('ejs').renderFile);
app.use(express.logger('dev'));
app.use(express.json());
app.use(express.urlencoded());
app.use(express.methodOverride());
app.use(app.router);
app.use(express.static(path.join(__dirname, 'public')));

// development only
if ('development' == app.get('env')) {
  app.use(express.errorHandler());
}

app.get('/', routes.index);
app.get('/chat', routes.chat);
app.get('/users', user.list);

// this is because of heroku's kickass https provisioning
if (process.env.ENVIRON == 'HEROKU'){
	server = http.createServer(app).listen(app.get('port'), function(){
  		console.log('Express server listening on port ' + app.get('port'));
	});	
}
else {
	var https = require('https');
	var fs = require('fs');

	var options = {
	  key: fs.readFileSync('test-certs/server.key'),
	  cert: fs.readFileSync('test-certs/server.crt')
	};

	server = https.createServer(options, app).listen(8433, function(){
		console.log('Express serving https on port 8433');
	})
}

var io = require('socket.io').listen(server);

// rooms which are currently available in chat
redisClient.lpush('rooms', 'Valhalla', 'Nirvana', 'Avesta');




function updateUserRoom(socket, room){
	console.log('adding ' + socket.username + ' to ' + room);
	if(socket.room){
		// leave the room
		socket.leave(socket.room);
		// remove them from the redis set for the room
		redisClient.srem(socket.room+":users", socketToRedisValue(socket));
		// tell the old room that the user left, and send the updated list to all folks in the room
		emitRoomUsersLeaving(socket);
	}
	// update the room name on the socket
	socket.room = room;
	// add the socket to the redis set for the room
	redisClient.sadd(room+":users", socketToRedisValue(socket));
	// join the room
	socket.join(room);
	// tell the new room that the user is joining, and send the updated list to all folks in the room
	emitRoomUsersEntering(socket);
	// update the room list for all users
	updateRooms();
}

function updateRooms(){
	var multi = redisClient.multi();
	// grab all rooms
	redisClient.lrange('rooms', '0', '-1', function(err, rooms){
		// for every room, grab the number of users in the room
		for(var room in rooms){
			console.log('reading cardinality of ' + rooms[room] + ':users');
			multi.scard(rooms[room]+':users');
		}
		// execute the cardinality grabs
		multi.exec(function(err, replies){
			console.log(replies);
			var response = {};
			// for every room, populate a hash with the key being the room and the value being the
			// cardinality of the room
			for(var i = 0; i<rooms.length; i++){
				response[rooms[i]] = replies[i];
			}
			// push out the hash to the sockets
			io.sockets.emit('updaterooms', response);
		});
	});
}


function emitRoomUsersEntering(socket){
	redisClient.smembers(socket.room+":users", function(err, users){
		if(!users){
			users = []
		}
		io.sockets.in(socket.room).emit('updateusers', socket.username, users, null, socket.room);
	});
}

function emitRoomUsersLeaving(socket){
	redisClient.smembers(socket.room+":users", function(err, users){
		if(!users){
			users = []
		}
		io.sockets.in(socket.room).emit('updateusers', null, users, socket.username, socket.room);
	});
}

function socketToRedisValue(socket){
	return socket.username + socket.pubkey;
}


io.use(function(socket, next){
	var des_nickname = socket.handshake.query.username;
	checkUsername(des_nickname, next);
})


function checkUsername(nickname, next){
	redisClient.sismember('users', nickname, function(err, resp){
		if(resp == 1){
			next(new Error('nickname in use'));
		}
		else{
			next();
		}
	})
}

io.sockets.on('connection', function (socket) {
	console.log(socket.handshake.query);
	console.log(socket.handshake.query.username);
	console.log(socket.handshake.query.pubkey);
	socket.username = socket.handshake.query.username;
	socket.pubkey = decodeURIComponent(socket.handshake.query.pubkey);
	redisClient.sadd('users', socket.username);

	// when the client emits 'sendchat', this listens and executes
	socket.on('sendchat', function (data) {
		// we tell the client to execute 'updatechat' with 2 parameters
		io.sockets.in(socket.room).emit('updatechat', socket.username, data);
	});

	socket.on('switchroom', function(newroom){
		// when the user switches a room, update the appropriate rooms
		updateUserRoom(socket, newroom);
	});

	// when the user disconnects.. perform this
	socket.on('disconnect', function(){
		// remove the user from the redis set for that room
		redisClient.srem(socket.room+":users", socketToRedisValue(socket));
		redisClient.srem('users', socket.username);
		// leave the room
		socket.leave(socket.room);
		// let the old room know that the user left, and give them the updated list of users
		emitRoomUsersLeaving(socket);
		updateRooms();
	});
});