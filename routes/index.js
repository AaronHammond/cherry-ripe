
/*
 * GET home page.
 */

exports.index = function(req, res){
  res.render('index.html');
};

exports.chat = function(req, res){
	res.render('chat.html');
}