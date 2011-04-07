/*global SceneJS, myModules, DP, BlenderExport, ASSERT, WebSocket, console, LOG, WebSocketProxy, SocketIoProxy */
/*global JSON */
/*global update */
(function(){
var cs = myModules.cs;
var mycs = myModules.mycs;
var myc = myModules.myc;

var CELL_TO_3D_UNIT = 2;
var myPlayerId = -1, field, proxy, fpsCounter;
var FPS = 60;

// util
function setMyInterval(proc, limit, unit){
	var start = (new Date()).getTime();
	var timer = setInterval(function(){
		var current = (new Date()).getTime();
		if (!proc(start, current, limit) || current > start + limit) {
			clearInterval(timer);
		}
	}, unit);
	return timer;
}

function Field(aspect){
	this.pieces = {};
	SceneJS.createNode({
		type: "scene",
		id: "the-scene",
		canvasId: "main_canvas",
		loggingElementId: "theLoggingDiv",	
		nodes: [{
			type: "lookAt",
			eye : { x: 10.0, y: -55, z: 10.0 },
			look : { z:2.0, x:2 },
			up : { z: 1.0 },
			id: "player_eye",
			nodes: [{
				type: "camera",
				optics: {
					type: "perspective",
					fovy : 25.0,
					aspect : aspect,
					near : 0.10,
					far : 300.0
				},
				nodes: [{
					type: "light",
					color: { r: 0.3, g: 0.3, b: 0.3 },
					diffuse: true,
					specular: true,
					dir: { x: -cs.MAX_X*CELL_TO_3D_UNIT/2, y: -cs.MAX_Y*CELL_TO_3D_UNIT/2, z: 10.0 }
				},
				{
					type: "light",
					color: { r: 0.3, g: 0.3, b: 0.3 },
					diffuse: true,
					specular: true,
					dir: { x: cs.MAX_X*CELL_TO_3D_UNIT/2, y: cs.MAX_Y*CELL_TO_3D_UNIT/2, z: 10.0 }
				},
				{
					type: "light",
					mode:				   "dir",
					color:				  { r: 0.5, g: 0.5, b: 0.5 },
					diffuse:				true,
					specular:			   true,
					dir:					{ x: 0.0, y: 0.0, z: 20.0 }
				},
				{
				    type: "material",
				    id: "floor",
				    baseColor:      { r: 0.2, g: 0.2, b: 0.2 },
				    shine:          6.0,
				    nodes: [{
			            type: "texture",
			            layers: [{
		                    uri: "img/floor.png",
		                    minFilter: "linearMipMapLinear",
		                    wrapS: "repeat",
		                    wrapT: "repeat",
		                    scale : { x: 30, y: 30, z: 1.0 }
			            }],
			            nodes: [{
							type: "translate",
							z: -2,
							nodes: [{
			                    type: "scale",
			                    x: 100.0,
			                    y: 100.0,
			                    z : 1.0,
			                    nodes: [{
			                            type: "cube"
			                    }]
							}]
			            }]
				    }]
				},
				{
					type: "node",
					id: "my-mount-node"
				}]
			}]
		}]
	});
}
Field.prototype.getPieceById = function(id){
	return this.pieces[id];
};
Field.prototype.appendPiece = function(id, piece){
	this.pieces[id] = piece;
};
Field.prototype.removePiece = function(id){
	delete this.pieces[id];
};
Field.prototype.cellTo3d = function(x, y){
	return {x: x * CELL_TO_3D_UNIT - cs.MAX_X*CELL_TO_3D_UNIT/2, y: y * CELL_TO_3D_UNIT - cs.MAX_Y*CELL_TO_3D_UNIT/2};	// todo fix size
};

function Piece(id, x, y, type, base3D){
	this.id = id;
	this.x = x;
	this.y = y;
	this.type = type;
	this.base3d = base3D;
	this.moveTimer = -1;
}
Piece.prototype.createNodes = function(){
	return [{
		type: "material",
		baseColor:	  { r: 1.0, g: 1.0, b: 1.0 },
		nodes: [{
			type: "texture",
			layers: [{
				uri: this.base3d.textureUri,
				blendMode: "multiply"
			}],
			nodes: [{
				type: "geometry",
				primitive: "triangles",				
				positions: this.base3d.vertices,
				uv: this.base3d.texCoords,
				indices: this.base3d.indices
			}]
		}]
	}];
};
Piece.prototype.createAndAppendElement = function(){
	var pos = field.cellTo3d(this.x, this.y);
	SceneJS.Message.sendMessage({
		command: "create",
		nodes: [{
			type: "translate",
			id: this.id,
			x: pos.x,
			y: pos.y,
			z: 0,
			nodes: [{
				type: "rotate",
				id: this.id + "rotate",
				angle: 0.0,
				z: 1.0,
				nodes: this.createNodes()
			}]
		}]
	});
	SceneJS.Message.sendMessage({
		command: "update",
		target: "my-mount-node",
		add: {
			node: this.id
		}
	});
	field.appendPiece(this.id, this);
};
Piece.prototype.destroy = function(){
	this._clearMoveTimer();
	SceneJS.Message.sendMessage({
	    command: "update",
	    target: "my-mount-node",
	    remove: {
	        node: this.id
	    }
	});
	field.removePiece(this.id);
};
Piece.prototype._updatePosition = function(){
	var pos = field.cellTo3d(this.x, this.y);
	SceneJS.withNode(this.id).set('x', pos.x);
	SceneJS.withNode(this.id).set('y', pos.y);
	update();
};
Piece.prototype._moveStep = function(start, current, limit, oldPiece3dX, oldPiece3dY){
	var piece3d = field.cellTo3d(this.x, this.y);

	var p = (current - start) / limit;
	if (p > 1) { p = 1; }
	var tmpX = oldPiece3dX + (piece3d.x - oldPiece3dX) * p;
	var tmpY = oldPiece3dY + (piece3d.y - oldPiece3dY) * p; 
	SceneJS.withNode(this.id).set('x', tmpX);
	SceneJS.withNode(this.id).set('y', tmpY);
	update();
	return true;
};
Piece.prototype.move = function(x, y){
	this.x = x;
	this.y = y;

	this._clearMoveTimer();

	var old_piece_3d_x = SceneJS.withNode(this.id).get('x');
	var old_piece_3d_y = SceneJS.withNode(this.id).get('y');
	var self = this;
	
	this.moveTimer = setMyInterval(function(start, current, limit){
		return self._moveStep(start, current, limit, old_piece_3d_x, old_piece_3d_y);
	}, 200, 30);
};
Piece.prototype._clearMoveTimer = function(){
	if (this.moveTimer != -1) {
		clearInterval(this.moveTimer);
		this.moveTimer = -1;
	}
};

function Player(id, x, y, dir){
	mycs.superClass(Player).constructor.apply(this, [id, x, y, 'player', this.base3d]);
	this.dir = dir;
	this.createAndAppendElement();
	this.turn(this.dir);
}
mycs.inherit(Player, Piece);
Player.prototype.base3d = BlenderExport.player;
Player.prototype.turn = function(dir){
	this.dir = dir;
	var dir_to_angle = {up: 0.0, right: 90.0, down: 180, left: 270};
	SceneJS.withNode(this.id + 'rotate').set('angle', dir_to_angle[this.dir]);
	update();
};
Player.prototype.createAndAppendElement = function(){
	mycs.superClass(Player).createAndAppendElement.apply(this, arguments);
	SceneJS.withNode(this.id).set('z', -0.5);
	update();
};
Player.prototype.kill = function(){
	this.destroy();
};

function MyPlayer(id, x, y, dir){
	this.eye3d = {x: 0.0, y: 0.0};
	this.eyeTimer = -1;
	mycs.superClass(MyPlayer).constructor.apply(this, [id, x, y, dir]);
}
mycs.inherit(MyPlayer, Player);
MyPlayer.prototype.base3d = BlenderExport.myPlayer;
MyPlayer.prototype.turn = function(dir){
	mycs.superClass(MyPlayer).turn.apply(this, arguments);
	this._updateEye();
};
MyPlayer.prototype.destroy = function(){
	myPlayerId = -1;
	this._clearEyeTimer();
	mycs.superClass(MyPlayer).destroy.apply(this, arguments);
};
MyPlayer.prototype._updatePosition = function(){
	mycs.superClass(MyPlayer)._updatePosition.apply(this, arguments);
	this._updateEye();
};
MyPlayer.prototype.move = function(x, y){
	mycs.superClass(MyPlayer).move.apply(this, arguments);
	this._updateEye();
};
MyPlayer.prototype._clearEyeTimer = function(){
	if (this.eyeTimer != -1) {
		clearInterval(this.eyeTimer);
		this.eyeTimer = -1;
	}
};
MyPlayer.prototype._setForwardEye = function(){
	var diff_2d = mycs.dirToDiff[this.dir];
	var last_eye_2d = {x: this.x - (diff_2d.dx * 10), y: this.y - (diff_2d.dy * 10)};
	var last_eye_3d = field.cellTo3d(last_eye_2d.x, last_eye_2d.y);
	
	var distance_3d_x = last_eye_3d.x - this.eye3d.x;
	var distance_3d_y = last_eye_3d.y - this.eye3d.y;
	var step = 0.6;
	
	if (distance_3d_x >= 0) {
		this.eye3d.x = this.eye3d.x + Math.min(distance_3d_x, step);
	} else {
		this.eye3d.x = this.eye3d.x + Math.max(distance_3d_x, -step);
	}
	if (distance_3d_y >= 0) {
		this.eye3d.y = this.eye3d.y + Math.min(distance_3d_y, step);
	} else {
		this.eye3d.y = this.eye3d.y + Math.max(distance_3d_y, -step);
	}

	var player_3d_x = SceneJS.withNode(this.id).get('x');
	var player_3d_y = SceneJS.withNode(this.id).get('y');
	
	SceneJS.withNode("player_eye").set("look", {x: player_3d_x, y: player_3d_y, z: 0});
	SceneJS.withNode("player_eye").set("eye", {x: this.eye3d.x, y: this.eye3d.y, z: 5});
	update();

	var doContinue = (Math.abs(distance_3d_x) > step) || (Math.abs(distance_3d_y) > step);
	return doContinue;
};
MyPlayer.prototype._updateEye = function(){
	this._clearEyeTimer();

	if (this._setForwardEye()) {
		var self = this;
		this.eyeTimer = setInterval(function(){
			if (!self._setForwardEye()) {
				clearInterval(self.eyeTimer);
				self.eyeTimer = -1;
			}
		}, 50);
	}
};

function HardBlock(id, x, y){
	mycs.superClass(HardBlock).constructor.apply(this, [id, x, y, 'hard_block', this.base3d]);
	this.createAndAppendElement();
}
mycs.inherit(HardBlock, Piece);
HardBlock.prototype.createNodes = function(){
	return [{
		type: "material",
		baseColor:	  { r: 0.2, g: 0.8, b: 0.9 },
		shine:          4.0,
		opacity:        0.9,
        nodes: [{
			type: "translate",
			z: -1,
			nodes: [{
				type : "cube",
				zSize : 0.3
			}]
        }]
	}];
};

function IceBlock(id, x, y){
	mycs.superClass(IceBlock).constructor.apply(this, [id, x, y, 'hard_block', this.base3d]);
	this.createAndAppendElement();
}
mycs.inherit(IceBlock, Piece);
IceBlock.prototype.createNodes = function(){
	return [{
		type: "material",
		baseColor:	  { r: 0.9, g: 0.8, b: 0.9 },
		shine:          4.0,
		opacity:        0.9,
		nodes: [{
			type : "cube",
			xSize : 0.9,
			ySize : 0.9,
			zSize : 0.9
		}]
	}];
};

function handleKeydown(e){
	var key_to_action = {
		38: {	// up
			name: 'move',
			dir: function(){
				return field.getPieceById(myPlayerId).dir;
			}
		},
		40: {	// down
			name: 'move',
			dir: function(){
				return cs.reverse_dir[field.getPieceById(myPlayerId).dir];
			}
		},
		37: {	// left
			name: 'turn',
			dir: function(){
				return {down:'left', up:'right', left:'up', right:'down'}[field.getPieceById(myPlayerId).dir];
			}
		},
		39: {	// right
			name: 'turn',
			dir: function(){
				return {down:'right', up:'left', left:'down', right:'up'}[field.getPieceById(myPlayerId).dir];
			}
		}
	};
	var action = key_to_action[e.keyCode];
	if (action) {
		if (myPlayerId != -1) {
			proxy.send({action: action.name, arg: {dir: action.dir()}});
		}
		e.preventDefault();
	}
}
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
				if (myPlayerId == data.arg.id) {
					new MyPlayer(data.arg.id, data.arg.x, data.arg.y, data.arg.dir);
				} else {
					new Player(data.arg.id, data.arg.x, data.arg.y, data.arg.dir);
				}
				break;
			default:
				ASSERT(false);
				break;
			}
			break;
		case 'destroy':
			field.getPieceById(data.arg.id).destroy();
			break;
		case 'move':
			field.getPieceById(data.arg.id).move(data.arg.x, data.arg.y);
			break;
		case 'turn':
			field.getPieceById(data.arg.id).turn(data.arg.dir);
			break;
		case 'kill':
			field.getPieceById(data.arg.id).kill();
			break;
		default:
			break;
	}
}

var updateFlag = true;
var render = function() {
	fpsCounter.count(function(fps){
		document.getElementById('fps').textContent = fps + ' / ' + FPS + ' fps';
	});
	if (updateFlag) {
		SceneJS.withNode("the-scene").render();
		updateFlag = false;
	}
};
var update = function(){
	updateFlag = true;
};
var canvas = document.getElementById("main_canvas");
function handleLoad(){
	var canvas = document.getElementById('main_canvas');
	var canvasBoundRect = canvas.getBoundingClientRect();
	var fps = document.getElementById('fps');
	fps.style.top = canvasBoundRect.top + window.scrollY + 'px';
	fps.style.left = canvasBoundRect.left + window.scrollX + 'px';
	
	field = new Field(canvas.width / canvas.height);
	fpsCounter = new mycs.XPSCounter();
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
	setInterval(render, 1000 / FPS);
}
window.addEventListener('load', handleLoad, true);
})();
