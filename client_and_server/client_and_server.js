/*global exports, myModules */
(function(){

if (typeof exports == 'undefined') {
	exports = {};
}
if (typeof myModules != 'undefined') {
	myModules.cs = exports;
}
exports.USE_PROFILE = false;
exports.USE_SOCKETIO = true;
exports.MAX_X = 40;	// 0 <= x <= MAX_X
exports.MAX_Y = 12;	// 0 <= y <= MAX_Y
exports.PORT = 8218;

})();
