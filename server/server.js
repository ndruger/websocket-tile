/*global require, JSON */
/*global HardBlock, IceBlock */
var sys = require('sys');
var csmy = require('../lib/my/my_client_and_server');
var cs = require('../client_and_server/client_and_server');
var sc = require('../lib/my/my_server');
if (!cs.USE_SOCKETIO) {
	var MAX_CONNECTION = 30;	// There is not way to limit connection in socket.io.
}
var DP = csmy.DP;
var LOG = csmy.LOG;
var ASSERT = csmy.ASSERT;

var TYPE_FLAG_HARD_BLOCK = 1;
var TYPE_FLAG_ICE_BLOCK = 2;
var TYPE_FLAG_PLAYER = 4;

var typeTextToFlag = {
	hard_block: TYPE_FLAG_HARD_BLOCK,
	ice_block: TYPE_FLAG_ICE_BLOCK,
	player: TYPE_FLAG_PLAYER
};
var field, proxy;

function Field(){
	this._idMap = {};
	this._posMap = [];
	for (var x = 0; x <= cs.MAX_X; x++) {
		this._posMap[x] = [];
		for (var y = 0; y <= cs.MAX_Y; y++) {
			this._posMap[x][y] = {};
		}
	}
}
Field.prototype.initialize = function(){
	this._initHardBlocks();
	this._initIceBlocks();
};
Field.prototype._initHardBlocks = function(){
	for (var y = 0; y <= cs.MAX_Y; y++) {
		for (var x = 0; x <= cs.MAX_X; x++) {
			if (
				// border
				(y === 0) ||
				(y !== 0 && x === 0) || (y !== 0 && x === cs.MAX_X) ||
				(y === cs.MAX_Y) ||
				// support
				(((y + 1) % 2 === 1) && ((x + 1) % 2 === 1))
			) {
				new HardBlock(x, y);
			}
		}
	}
};
Field.prototype._initIceBlocks = function(){
	var emptyCells = this.getEmptyCells();
	if (emptyCells.length === 0) {
		return;
	}
	var len = Math.min(65, emptyCells.length);
	for (var i = 0; i < len; i++) {
		var index = Math.floor(Math.random() * emptyCells.length);
		var cell = emptyCells[index];
		new IceBlock(cell.x, cell.y);
		emptyCells.splice(index, 1);
	}
};
Field.prototype.sendMap = function(conn){
	for (var id in this._idMap) {
		this._idMap[id].sendMap(conn);
	}
};
Field.prototype.getEmptyCells = function(){
	var emptyCells = [];
	for (var x = 0; x <= cs.MAX_X; x++) {
		for (var y = 0; y <= cs.MAX_Y; y++) {
			if (!this.getFirstPiece(x, y)) {
				var pos = {x: x, y: y};
				emptyCells.push(pos);
			}
		}
	}
	return emptyCells;
};
Field.prototype.getRandomEmptyCell = function(){
	var cells = field.getEmptyCells();
	if (cells.length === 0) {
		return null;
	}
	return cells[Math.floor(Math.random() * cells.length)];
};
Field.prototype.getFirstPiece = function(x, y, opt_typeFlag){
	var cellPieces = this._posMap[x][y];
	for (var id in cellPieces) {
		if (typeof opt_typeFlag != 'undefined') {
			if (typeTextToFlag[cellPieces[id].type] & opt_typeFlag) {
				return cellPieces[id];
			}
		} else {
			return cellPieces[id];
		}
	}
	return null;
};
Field.prototype.getPiece = function(id){
	return field._idMap[id];
};
Field.prototype.addPiece = function(in_piece, id, x, y){
	ASSERT(!(id in this._idMap));
	this._idMap[id] = in_piece;
	ASSERT(!(id in this._posMap[x][y]));
	this._posMap[x][y][id] = in_piece;
};
Field.prototype.removePiece = function(id, x, y){
	ASSERT(id in this._idMap);
	delete this._idMap[id];
	ASSERT(id in this._posMap[x][y]);
	delete this._posMap[x][y][id];
};

function Piece(x, y){
	this.type = 'unknown';
	this.id = String(Math.floor(Math.random() * 10000000));	// this program is example. use id pool for formal program.
	this._dir = 'down';
	this._x = x;
	this._y = y;
}
Piece.prototype.createSendData = function(action, arg){
	return {
		action: action,
		arg: arg
	};
};
Piece.prototype.destroy = function(){
	this.removeFromField();
	proxy.broadcast(this.createSendData('destroy', {
		type: this.type,
		id: this.id,
		x: this._x,
		y: this._y
	}));
};
Piece.prototype.sendMap = function(in_conn){
	proxy.send(in_conn, this.createSendData('send_map', {
		type: this.type,
		id: this.id,
		x: this._x,
		y: this._y,
		dir: this._dir
	}));
};
Piece.prototype.sendCreate = function(){
	proxy.broadcast(this.createSendData('create', {
		type: this.type,
		id: this.id,
		x: this._x,
		y: this._y,
		dir: this._dir
	}));
};
Piece.prototype.move = function(newX, newY, sourceId, sourceTime){
	this.removeFromField();
	this._x = newX;
	this._y = newY;
	this.addToField();

	proxy.broadcast(this.createSendData('move', {
		type: this.type,
		id: this.id,
		x: this._x,
		y: this._y,
		sourceId: sourceId, 
		sourceTime: sourceTime
	}));
};
Piece.prototype.removeFromField = function(){
	field.removePiece(this.id, this._x, this._y);
};
Piece.prototype.addToField = function(){
	field.addPiece(this, this.id, this._x, this._y);
};

function IceBlock(x, y){
	csmy.superClass(IceBlock).constructor.apply(this, [x, y]);
	this._sliding = false;
	this.type = 'ice_block';
	this.addToField();
	this.sendCreate();
}
csmy.inherit(IceBlock, Piece);
IceBlock.prototype.startSlide = function(in_dir){
	if (this._sliding) {
		return;
	}
	this._sliding = true;
	var self = this;
	var slideData = { dir: in_dir, power: 20 };
	var timer = setInterval(function(){
		slideData.dir = self.slide(slideData);
		slideData.power--;
		if (slideData.power <= 0) {
			clearInterval(timer);
			self._sliding = false;
		}
	}, 100);
};
IceBlock.prototype.slide = function(slideData){
	var diff = csmy.dirToDiff[slideData.dir];
	var newX = this._x + diff.dx;
	var newY = this._y + diff.dy;

	var piece = field.getFirstPiece(newX, newY, TYPE_FLAG_PLAYER | TYPE_FLAG_HARD_BLOCK | TYPE_FLAG_ICE_BLOCK);
	if (piece) {
		if (piece.type === 'hard_block' || piece.type === 'ice_block') {
			return csmy.reverseDir[slideData.dir];
		} else if (piece.type === 'player') {
			var player = piece;
			if (field.getFirstPiece(newX + diff.dx, newY + diff.dy, TYPE_FLAG_PLAYER | TYPE_FLAG_HARD_BLOCK | TYPE_FLAG_ICE_BLOCK)) {
				player.kill();
			} else {
				player.move(slideData.dir);
			}
		}
	}

	csmy.superClass(IceBlock).move.apply(this, [newX, newY]);
	return slideData.dir;
};

function HardBlock(x, y){
	csmy.superClass(HardBlock).constructor.apply(this, [x, y]);
	this.type = 'hard_block';
	this.addToField();
	this.sendCreate();
}
csmy.inherit(HardBlock, Piece);

function Player(x, y, opt_conn){
	csmy.superClass(Player).constructor.apply(this, [x, y]);
	this.type = 'player';
	if (typeof opt_conn != 'undefined') {
		this.connection = opt_conn;
		proxy.send(this.connection, this.createSendData('set_player_id', { id: this.id }));
	}
	this.addToField();
	this.sendCreate();
}
csmy.inherit(Player, Piece);
Player.prototype.move = function(dir, sourceId, sourceTime){
	var diff = csmy.dirToDiff[dir];
	if (diff) {
		var new_x = this._x + diff.dx;
		var new_y = this._y + diff.dy;
		if (field.getFirstPiece(new_x, new_y, TYPE_FLAG_HARD_BLOCK | TYPE_FLAG_PLAYER)) {
			return;
		}
		var iceBlock = field.getFirstPiece(new_x, new_y, TYPE_FLAG_ICE_BLOCK);
		if (iceBlock) {
			iceBlock.startSlide(dir);
			return;
		}
		csmy.superClass(Player).move.apply(this, [new_x, new_y, sourceId, sourceTime]);
	}
};
Player.prototype.turn = function(in_dir){
	proxy.broadcast(this.createSendData('turn', {
		type: this.type,
		id: this.id,
		dir: in_dir
	}));
};
Player.prototype.kill = function(){
	proxy.broadcast(this.createSendData('kill', {
		type: this.type,
		id: this.id
	}));
	this.removeFromField();
};

function handleOpen(client){
	LOG('connection');
	field.sendMap(client);
	var cell = field.getRandomEmptyCell();
	if (cell !== null) {
		client.playerId = (new Player(cell.x, cell.y, client)).id;	// Player factory and lobby are too complex for example
	}
}
function handleMessage(data, client){
	var player = field.getPiece(client.playerId);
	if (!player) {	// dead etc
		return;
	}
	switch(data.action){
		case 'move':
			player.move(data.arg.dir, data.arg.sourceId, data.arg.sourceTime);
			break;
		case 'turn':
			player.turn(data.arg.dir);
			break;
		case 'echo':
			if (cs.USE_PROFILE) {
				proxy.broadcast({ action: 'echo', arg: {
					sourceTime: data.arg.sourceTime,
					sourceId: data.arg.sourceId
				}});
			}
			break;
		default:
			LOG('datasage: unknown message type');
			break;
	}
}
function handleClose(client){
	LOG('disconnect');
	var player = field.getPiece(client.playerId);
	if (!player) {
		return;
	}
	player.destroy();
}

if (cs.USE_SOCKETIO) {
	proxy = new sc.SocketIoProxy(cs.PORT, handleOpen, handleMessage, handleClose);
} else {
	proxy = new sc.WebSocketProxy(cs.PORT, handleOpen, handleMessage, handleClose, MAX_CONNECTION);
}
field = new Field();
field.initialize();
// var cell = field.getRandomEmptyCell();
// new Player(cell.x, cell.y);	// dummy player for test
