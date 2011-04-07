/*global exports, $, JSON, cs, ASSERT, LOG, io, DP, KeyEvent, WebSocketProxy, SocketIoProxy, myModules */
(function(){
var cs = myModules.cs;
var mycs = myModules.mycs;
var myc = myModules.myc;

var TILE_SIZE = 32;

var profile = {};
var myPlayerId = -1, field, proxy;

// Field
function Field(){
	this._idMap = {};
}
Field.cellToPx = function(x, y){
	ASSERT(x >= 0 && x <= cs.MAX_X && y >= 0 && y <= cs.MAX_Y);
	var pxX = x * TILE_SIZE;
	var pxY = y * TILE_SIZE;
	return {x: pxX, y: pxY};
};
Field.prototype.getPiece = function(id){
	return field._idMap[id];
};
Field.prototype.addPiece = function(id, piece){
	ASSERT(!(id in this._idMap));
	this._idMap[id] = piece;
};
Field.prototype.removePiece = function(id){
	ASSERT(id in this._idMap);
	delete this._idMap[id];
};

// Piece
function Piece(id, x, y, type, overhang){
	this._id = id;
	this._x = x;
	this._y = y;
	this._type = type;
	this._overhang = overhang;
	this._imgElement = null;
	
	this._createAndAppendElement();
	field.addPiece(this._id, this);
}
Piece.prototype.setPosition = function(x, y){
	var px = Field.cellToPx(x, y);
	var style = this.element().style;
	style.top = px.y - this._overhang;
	style.left = px.x;
	style.zIndex = px.y;
};
Piece.prototype.move = function(x, y){
	var px = Field.cellToPx(x, y);

	var ele = this.element();
	if (typeof ele.style.webkitTransform != 'undefined') {
		$('#' + this._id).transitionAnimate({
			top: px.y - this._overhang,
			left: px.x
		}, '100ms', 'linear', null);
	} else {
		$('#' + this._id).stop(true, false).animate({
			top: px.y - this._overhang,
			left: px.x
		}, 100);
	}
	ele.style.zIndex = px.y;	// cover back piece by overhang height
};
Piece.prototype.element = function(){
	return document.getElementById(this._id);
};
Piece.prototype._createAndAppendElement = function(){
	var ele = document.createElement('div');
	ele.id = this._id;
	ele.className = this._type;
	ele.style.width = TILE_SIZE;
	ele.style.height = TILE_SIZE + this._overhang;

	this._imgElement = document.createElement('img');
	ele.appendChild(this._imgElement);
	document.getElementById('field_div').appendChild(ele);
	this.setPosition(this._x, this._y);
};
Piece.prototype.destroy = function(){
	field.removePiece(this._id);
	var ele = this.element(); 
	ele.parentNode.removeChild(ele);
};

// Player
function Player(id, x, y, dir, isMyPlayer){
	mycs.superClass(Player).constructor.apply(this, [id, x, y, 'hard_block', 16]);
	this._imgElement.src = 'img/player.png';
	this._isMyPlayer = isMyPlayer;
	this.turn(dir);
}
mycs.inherit(Player, Piece);
Player.prototype.turn = function(in_dir){
	var dirToTurn = {
		'down': 0,
		'left': 1,
		'right': 2,
		'up': 3
	};
	if (this._isMyPlayer) {
		this._imgElement.style.top = - (TILE_SIZE + this._overhang) * dirToTurn[in_dir];
	} else {
		this._imgElement.style.top = - (TILE_SIZE + this._overhang) * (dirToTurn[in_dir] + 4);	// css sprite
	}
};
Player.prototype.kill = function(){
	if (this._id === myPlayerId) {
		myPlayerId = -1;
	}
	this.destroy();
};

// Hard Block
function HardBlock(id, x, y){
	mycs.superClass(HardBlock).constructor.apply(this, [id, x, y, 'hard_block', 0]);
	this._imgElement.src = 'img/hard_block.png';
}
mycs.inherit(HardBlock, Piece);

// Ice Block
function IceBlock(id, x, y){
	mycs.superClass(IceBlock).constructor.apply(this, [id, x, y, 'ice_block', 0]);
	this._imgElement.src = 'img/ice_block.png';
}
mycs.inherit(IceBlock, Piece);

// handler
function handleMessage(data){
	switch(data.action) {
		case 'set_player_id':
			myPlayerId = data.arg.id;
			break;
		case 'create':	// through
		case 'send_map':
			switch(data.arg.type){
			case 'ice_block':
				new IceBlock(data.arg.id, data.arg.x, data.arg.y);
				break;
			case 'hard_block':
				new HardBlock(data.arg.id, data.arg.x, data.arg.y);
				break;
			case 'player':
				var isMyPlayer = (myPlayerId == data.arg.id);
				var player = new Player(data.arg.id, data.arg.x, data.arg.y, data.arg.dir, isMyPlayer);
				if (isMyPlayer) {
					LOG('handlemessage: my player was created.');
				}
				break;
			default:
				ASSERT(false);
				break;
			}
			break;
		case 'destroy':
			field.getPiece(data.arg.id).destroy();
			break;
		case 'move':
			if (cs.USE_PROFILE) {
				if (profile.id !== data.arg.sourceId) {
					proxy.send({
						action: 'echo',
						arg: {
							sourceTime: data.arg.sourceTime,
							sourceId: data.arg.sourceId
						}
					});
				}
			}
			field.getPiece(data.arg.id).move(data.arg.x, data.arg.y);
			break;
		case 'turn':
			field.getPiece(data.arg.id).turn(data.arg.dir);
			break;
		case 'kill':
			field.getPiece(data.arg.id).kill();
			break;
		case 'echo':
			if (cs.USE_PROFILE) {
				if (profile.id === data.arg.sourceId) {
					var output = document.getElementById('output');
					output.value = (Date.now() - data.arg.sourceTime) + 'ms\n' + output.value;
				}
			}
			break;
		default:
			ASSERT(false);
			break;
	}
}

function startDebugLoop(){
	var currentDir = 'left';
	function move(){
		proxy.send({action: 'turn', arg:{dir: currentDir }});
		profile.id = Math.random() * 100000000;
		profile.sourceTime = Date.now();
		proxy.send({
			action: move, arg: {
				dir: currentDir,
				sourceTime: profile.sourceTime,
				sourceId: profile.id
			}
		});
		currentDir = (currentDir === 'left') ? 'right' : 'left';
		setTimeout(move, Math.random() * 1000);
	}
	setTimeout(move, 0);
}

function handleKeydown(e){
	switch (e.keyCode) {
	case KeyEvent.DOM_VK_LEFT:
	case KeyEvent.DOM_VK_UP:
	case KeyEvent.DOM_VK_RIGHT:
	case KeyEvent.DOM_VK_DOWN:
		var keyToDir = {};
		keyToDir[KeyEvent.DOM_VK_LEFT] = 'left';
		keyToDir[KeyEvent.DOM_VK_UP] = 'up';
		keyToDir[KeyEvent.DOM_VK_RIGHT] = 'right';
		keyToDir[KeyEvent.DOM_VK_DOWN] = 'down';
		var dir = keyToDir[e.keyCode];
		if (proxy) {
			if (myPlayerId !== -1) {
				proxy.send({action: 'turn', arg: {dir: dir}});
				profile.id = Math.random() * 100000000;
				profile.sourceTime = Date.now();
				proxy.send({action: 'move', arg:{dir: dir, sourceTime: profile.sourceTime, sourceId: profile.id}});
			}
		}
		e.preventDefault();
		break;
	case KeyEvent.DOM_VK_1:
		startDebugLoop();
		break;
	}
}

window.addEventListener('load', function(){
	var fieldElement = document.getElementById('field_div');
	fieldElement.style.width = TILE_SIZE * (cs.MAX_X + 1);
	fieldElement.style.height = TILE_SIZE * (cs.MAX_Y + 1);
	if (cs.USE_PROFILE) {
		document.getElementById('output').style.display = 'block';
	}

	field = new Field();
	var proxyConstructor;
	if (cs.USE_SOCKETIO) {
		proxyConstructor = myc.SocketIoProxy;
	} else {
		proxyConstructor = myc.WebSocketProxy;
	}
	proxy = new proxyConstructor(
		cs.PORT,
		function(e){
			LOG('open');
			window.addEventListener('keydown', handleKeydown, false);
		},
		handleMessage,
		function(e){
			LOG('close');
			myPlayerId = -1;
		}
	);
}, false);

window.addEventListener('unload', function(){	// for browser bug
	if (proxy) {
		proxy.close();
	}
}, false);
})();
