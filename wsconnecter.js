/**
 * Copyright FunASR (https://github.com/alibaba-damo-academy/FunASR). All Rights
 * Reserved. MIT License  (https://opensource.org/licenses/MIT)
 */
/* 2021-2023 by zhaoming,mali aihealthx.com */

function WebSocketConnectMethod( config ) { //定义socket连接方法类

	
	var speechSokt;
	var connKeeperID;
	
	var msgHandle = config.msgHandle;
	var stateHandle = config.stateHandle;
			  
	this.wsStart = function () {
		var Uri = document.getElementById('wssip').value; //"wss://111.205.137.58:5821/wss/" //设置wss asr online接口地址 如 wss://X.X.X.X:port/wss/
		if(Uri.match(/wss:\S*|ws:\S*/))
		{
			console.log("Uri"+Uri);
		}
		else
		{
			alert("请检查wss地址正确性");
			return 0;
		}
 
		if ( 'WebSocket' in window ) {
			speechSokt = new WebSocket( Uri ); // 定义socket连接对象
			speechSokt.onopen = function(e){onOpen(e);}; // 定义响应函数
			speechSokt.onclose = function(e){
			    console.log("onclose ws!");
			    //speechSokt.close();
				onClose(e);
				};
			speechSokt.onmessage = function(e){onMessage(e);};
			speechSokt.onerror = function(e){onError(e);};
			return 1;
		}
		else {
			alert('当前浏览器不支持 WebSocket');
			return 0;
		}
	};
	
	// 定义停止与发送函数
	this.wsStop = function () {
		if(speechSokt != undefined) {
			console.log("stop ws!");
			speechSokt.close();
		}
	};
	
	this.wsSend = function ( oneData ) {
 
		if(speechSokt == undefined) { console.warn("wsSend: socket is undefined, dropping data"); return; }
		if ( speechSokt.readyState === 1 ) {
 
			speechSokt.send( oneData );
 
			
		} else {
			console.warn("wsSend: socket not OPEN (readyState=" + speechSokt.readyState + "), dropping data");
		}
	};
	// SOCEKT连接中的消息与状态响应
	function onOpen( e ) {
		// 发送json
		var chunk_size = new Array( 5, 10, 5 );
		var request = {
			"chunk_size": chunk_size,
			"wav_name":  "h5",
			"is_speaking":  true,
			"chunk_interval":10,
			"itn":getUseITN(),
			"mode":getAsrMode(),
			
		};
		if(isfilemode)
		{
			// 文件统一走服务端「整段缓冲→解码→整段离线转写」路径（后端 flush_file_buffer），
			// 避免 16k WAV 落入实时逐帧 VAD 流式路径（大块 160ms 帧会撑爆 FSMN-VAD，
			// 报 "index N out of bounds for size N"）。
			// wav_format="others" 会让后端 need_decode=True 从而缓冲整段，
			// 再用 ffmpeg/soundfile 解码完整文件（含头/容器）为 16k 单声道 PCM。
			request.wav_format="others";
			request.audio_fs=file_sample_rate || 16000;
		}
		
		var hotwords=getHotwords();
 
		if(hotwords!=null  )
		{
			request.hotwords=hotwords;
		}
		console.log(JSON.stringify(request));
		speechSokt.send(JSON.stringify(request));
		console.log("连接成功");
		stateHandle(0);
 
	}
	
	function onClose( e ) {
		stateHandle(1);
	}
	
	function onMessage( e ) {
 
		msgHandle( e );
	}
	
	function onError( e ) {
 
		info_div.innerHTML="连接"+e;
		console.log(e);
		stateHandle(2);
		
	}
    
 
}