/**
 * Copyright FunASR (https://github.com/alibaba-damo-academy/FunASR). All Rights
 * Reserved. MIT License  (https://opensource.org/licenses/MIT)
 */
/* 2022-2023 by zhaoming,mali aihealthx.com */
// 连接; 定义socket连接类对象与语音对象
var wsconnecter = new WebSocketConnectMethod({msgHandle:getJsonMessage,stateHandle:getConnState});
var audioBlob;

// 录音; 定义录音对象,wav格式
var rec = Recorder({
	type:"pcm",
	bitRate:16,
	sampleRate:16000,
	onProcess:recProcess
});
var sampleBuf=new Int16Array();
// 定义按钮响应事件
var btnStart = document.getElementById('btnStart');
btnStart.onclick = function() {
	if (isfilemode) {
		// 必须先选择文件
		if (!file_data_array || file_data_array.byteLength === 0) {
			info_div.innerHTML = '请先选择音频文件';
			return;
		}
		file_send_complete = false;
		file_send_aborted = false;
		btnStart.disabled = true;
		btnStop.disabled = false;   // 允许中途停止
		btnConnect.disabled = true;

		if (is_ws_connected) {
			// 已有活动连接：配置帧已在 onOpen 发送，直接推送音频数据
			info_div.innerHTML = '正在上传文件转写，请耐心等待...';
			start_file_send();
		} else {
			// 未连接：新建连接，onOpen 发完配置帧后自动开始推送
			// 避免「连接」与「开始」间的空闲期被服务端超时断开导致数据丢失
			info_div.innerHTML = '正在连接服务器并上传文件，请耐心等待...';
			_pending_action = 'file';
			clear();
			file_send_complete = false;
			file_send_aborted = false;
			var ret = wsconnecter.wsStart();
			if (ret !== 1) {
				_pending_action = null;
				info_div.innerHTML = '连接失败，请检查服务器地址';
				btnStart.disabled = false;
				btnStop.disabled = true;
				btnConnect.disabled = false;
			}
		}
	} else {
		record();
	}
};
var btnStop = document.getElementById('btnStop');
btnStop.onclick = stop;
btnStop.disabled = true;
btnStart.disabled = true;

btnConnect= document.getElementById('btnConnect');
btnConnect.onclick = start;
var rec_text="";  // for online rec asr result
var offline_text=""; // for offline rec asr result
var prev_display_text=""; // store previous display text for correction diff
var info_div = document.getElementById('info_div');

var upfile = document.getElementById('upfile');

var isfilemode=false;  // if it is in file mode
var file_ext="";
var file_sample_rate=16000; //for wav file sample rate
var file_data_array;  // array to save file data

var totalsend=0;

// 文件上传状态
var file_wav_data_pos = 0;       // WAV 文件中 PCM 数据起始位置（跳过头部）
var file_wav_num_channels = 1;   // WAV 文件声道数
var file_send_aborted = false;   // 上传是否被用户中止
var file_send_complete = false;  // 上传+识别是否已完成
var is_ws_connected = false;      // WebSocket 连接状态（跨模式共用）
var _pending_action = null;          // 连接建立后自动执行: 'file' | 'mic'

// 前端连接地址(仅本地方便): wss://188.18.54.94:10096/ws
// 注意: 对外接口文档公布的调用地址是 ws://188.18.18.106:10095, 两者相互独立
document.getElementById('wssip').value = 'wss://188.18.54.94:10096/ws';

upfile.onclick=function()
{
		btnStart.disabled = true;
		btnStop.disabled = true;
		file_send_complete = false;
		file_send_aborted = false;
}

// from https://github.com/xiangyuecn/Recorder/tree/master
var readWavInfo=function(bytes){
	//读取wav文件头，统一成44字节的头
	if(bytes.byteLength<44){
		return null;
	};
	var wavView=bytes;
	var eq=function(p,s){
		for(var i=0;i<s.length;i++){
			if(wavView[p+i]!=s.charCodeAt(i)){
				return false;
			};
		};
		return true;
	};

	if(eq(0,"RIFF")&&eq(8,"WAVEfmt ")){

		var numCh=wavView[22];
		if(wavView[20]==1 && (numCh==1||numCh==2)){//raw pcm 单或双声道
			var sampleRate=wavView[24]+(wavView[25]<<8)+(wavView[26]<<16)+(wavView[27]<<24);
			var bitRate=wavView[34]+(wavView[35]<<8);
			var heads=[wavView.subarray(0,12)],headSize=12;//head只保留必要的块
			//搜索data块的位置
			var dataPos=0; // 44 或有更多块
			for(var i=12,iL=wavView.length-8;i<iL;){
				if(wavView[i]==100&&wavView[i+1]==97&&wavView[i+2]==116&&wavView[i+3]==97){//eq(i,"data")
					heads.push(wavView.subarray(i,i+8));
					headSize+=8;
					dataPos=i+8;break;
				}
				var i0=i;
				i+=4;
				i+=4+wavView[i]+(wavView[i+1]<<8)+(wavView[i+2]<<16)+(wavView[i+3]<<24);
				if(i0==12){//fmt
					heads.push(wavView.subarray(i0,i));
					headSize+=i-i0;
				}
			}
			if(dataPos){
				var wavHead=new Uint8Array(headSize);
				for(var i=0,n=0;i<heads.length;i++){
					wavHead.set(heads[i],n);n+=heads[i].length;
				}
				return {
					sampleRate:sampleRate
					,bitRate:bitRate
					,numChannels:numCh
					,wavHead44:wavHead
					,dataPos:dataPos
				};
			};
		};
	};
	return null;
};

// ========== 文件上传：选择文件 ==========
upfile.onchange = function () {
	file_send_complete = false;
	file_send_aborted = false;
	var file = this.files[0];
	if (!file) return;

	var fileName = file.name;
	var fileSize = file.size;
	file_ext = fileName.split('.').pop().toLowerCase();

	// UI: 显示文件卡片
	var uploadZone = document.getElementById('upload_zone');
	var fileCard = document.getElementById('file_card');
	var audioWrap = document.getElementById('audio_player_wrap');
	uploadZone.classList.add('has-file');
	fileCard.style.display = 'flex';
	audioWrap.style.display = 'block';
	document.getElementById('file_card_name').textContent = fileName;
	var sizeMB = (fileSize / 1024 / 1024).toFixed(2);
	var sizeKB = (fileSize / 1024).toFixed(0);
	var sizeText = fileSize > 1024*1024 ? sizeMB + ' MB' : sizeKB + ' KB';
	document.getElementById('file_card_meta').textContent = sizeText + ' · ' + file_ext.toUpperCase();

	var reader = new FileReader();
	reader.readAsArrayBuffer(file);

	reader.onload = function() {
		var rawBuf = new Uint8Array(reader.result);
		file_data_array = reader.result;

		if (file_ext === "wav") {
			// 解析 WAV 头，获取采样率、声道数、PCM 数据起始位置
			var info = readWavInfo(rawBuf);
			if (info) {
				file_sample_rate = info.sampleRate;
				file_wav_num_channels = info.numChannels;
				file_wav_data_pos = info.dataPos;
				console.log("WAV info:", info);
			} else {
				// 无法解析 WAV 头，当作原始 PCM 处理
				file_sample_rate = 16000;
				file_wav_num_channels = 1;
				file_wav_data_pos = 0;
				console.warn("无法解析 WAV 头，按 16k/单声道 PCM 处理");
			}
		} else {
			// 非 WAV 文件（mp3/m4a/flac/ogg 等），服务端 ffmpeg 解码
			file_wav_data_pos = 0;
			file_sample_rate = 16000;
			file_wav_num_channels = 1;
		}

		// 试听预览：用原始文件 Blob 创建 URL
		var mimeMap = { wav: "wav", mp3: "mpeg", m4a: "mp4", flac: "flac", ogg: "ogg", aac: "aac", wma: "x-ms-wma" };
		var mimeType = "audio/" + (mimeMap[file_ext] || file_ext);
		var fileBlob = new Blob([rawBuf], {type: mimeType});
		var audio_preview = document.getElementById('audio_file_preview');
		audio_preview.src = (window.URL || webkitURL).createObjectURL(fileBlob);
		audio_preview.controls = true;

		// 按钮状态更新
		if (btnConnect.disabled && isfilemode) {
			info_div.innerHTML = '文件已就绪，请点击「开始」上传转写';
			btnStart.disabled = false;
		} else {
			info_div.innerHTML = '请点击「连接」建立连接，再点击「开始」转写';
			btnConnect.disabled = false;
		}
	};

	reader.onerror = function(e) {
		console.log('文件读取错误: ' + e);
		info_div.innerHTML = '文件读取失败，请重试';
	};
};

function play_file()
{
			  var audioblob = new Blob([new Uint8Array(file_data_array)], {type: "audio/wav"});
			  var audio_file_el = document.getElementById('audio_file_preview');
			  audio_file_el.src = (window.URL || webkitURL).createObjectURL(audioblob);
			  audio_file_el.controls = true;
			  // audio_file_el.play();  // not auto play
}

// ========== 文件上传：分块发送音频数据 ==========
function start_file_send()
{
	file_send_aborted = false;

	// 发送完整文件（含 WAV 头/容器）。
	// 服务端按 wav_format="others" 整段缓冲后用 ffmpeg/soundfile 解码，
	// 需要完整容器才能解析，故不再跳过 WAV 头部。
	var rawBytes = new Uint8Array(file_data_array);
	console.log("发送完整文件 " + rawBytes.length + " 字节 (" + file_ext + ")");

	var totalSize = rawBytes.length;
	var chunkSize = 5120; // 5KB 每块，平衡效率与 UI 响应
	var offset = 0;

	function sendNextChunk() {
		// 用户点击了停止
		if (file_send_aborted) {
			console.log("文件上传已被用户中止");
			return;
		}

		if (offset >= totalSize) {
			// 所有数据发送完毕，发送 is_speaking=false 触发服务端解码+转写
			info_div.innerHTML = '上传完成，正在转写识别...';
			sendFileComplete();
			return;
		}

		var end = Math.min(offset + chunkSize, totalSize);
		var chunk = rawBytes.slice(offset, end);
		wsconnecter.wsSend(chunk);
		offset = end;

		var pct = Math.round(offset / totalSize * 100);
		info_div.innerHTML = '上传中... ' + pct + '% (' + formatSize(offset) + '/' + formatSize(totalSize) + ')';

		// 让出主线程，保持 UI 响应
		setTimeout(sendNextChunk, 5);
	}

	sendNextChunk();
}

// 发送 is_speaking=false 信号，触发服务端 flush_file_buffer 解码+转写
function sendFileComplete() {
	var chunk_size = new Array(5, 10, 5);
	var request = {
		"chunk_size": chunk_size,
		"wav_name": "h5",
		"is_speaking": false,
		"chunk_interval": 10,
		"mode": getAsrMode(),
	};
	// 清空残留 buffer
	if (sampleBuf.length > 0) {
		wsconnecter.wsSend(sampleBuf);
		sampleBuf = new Int16Array();
	}
	wsconnecter.wsSend(JSON.stringify(request));
	isRec = false;
	// 更新文件转写状态
	var fileBadge = document.getElementById('fileRecognitionBadge');
	fileBadge.textContent = '识别中…';
	fileBadge.style.background = '#fff7ed';
	fileBadge.style.color = '#ea580c';
	console.log("文件模式: 已发送 is_speaking=false，等待服务端返回结果...");
}

// 格式化文件大小显示
function formatSize(bytes) {
	if (bytes < 1024) return bytes + ' B';
	if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
	return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function on_recoder_mode_change()
{
			var item = null;
			var obj = document.getElementsByName("recoder_mode");
			for (var i = 0; i < obj.length; i++) { //遍历Radio
				if (obj[i].checked) {
					item = obj[i].value;
					break;
				}
		   }
			if(item=="mic")
			{
				document.getElementById("mic_mode_div").style.display = 'block';
				document.getElementById("file_section").style.display = 'none';
				document.getElementById("mic_transcription_card").style.display = '';
				isfilemode=false;

				if (is_ws_connected) {
					btnConnect.disabled = true;
					btnStart.disabled = false;
					btnStop.disabled = true;
					info_div.innerHTML = '已连接（麦克风模式），请点击「开始」录音';
				} else {
					btnStart.disabled = true;
					btnStop.disabled = true;
					btnConnect.disabled = false;
				}
				// 重置文件状态
				file_send_complete = false;
				file_send_aborted = false;
			}
			else
			{
				document.getElementById("mic_mode_div").style.display = 'none';
				document.getElementById("file_section").style.display = 'block';
				document.getElementById("mic_transcription_card").style.display = 'none';
				isfilemode=true;
				// 重置文件状态与结果区
				file_send_complete = false;
				file_send_aborted = false;
				document.getElementById('file_result_area').style.display = 'block';
				document.getElementById('fileTranscriptionBody').textContent = '';
				var fileBadge = document.getElementById('fileRecognitionBadge');
				fileBadge.textContent = '等待转写';
				fileBadge.style.background = '#e8f0fe';
				fileBadge.style.color = '#1a73e8';
				if (is_ws_connected) {
					btnConnect.disabled = true;
					if (file_data_array && file_data_array.byteLength > 0) {
						btnStart.disabled = false;
						btnStop.disabled = true;
						info_div.innerHTML = "已连接（文件模式），请点击「开始」上传转写";
					} else {
						btnStart.disabled = true;
						btnStop.disabled = true;
						info_div.innerHTML = "已连接，请选择音频文件上传";
					}
				} else {
					btnStart.disabled = true;
					btnStop.disabled = true;
					btnConnect.disabled = false;
					if (file_data_array && file_data_array.byteLength > 0) {
						info_div.innerHTML = "文件已选择，点击「连接」后点击「开始」转写";
					} else {
						info_div.innerHTML = "请选择音频文件，点击「连接」后点击「开始」转写";
					}
				}
			}
}
function getHotwords(){

	var obj = document.getElementById("varHot");

	if(typeof(obj) == 'undefined' || obj==null || obj.value.trim().length<=0){
	  return null;
	}
	// 直接返回 textarea 原始内容（每行 "词 权重"），这正是 FunASR contextual 模型期望的格式
	// 例如："竞业达 60\nhello world 40" → model.generate(hotword="竞业达 60\nhello world 40")
	var val = obj.value.trim();
	console.log("hotwords="+val);
	return val;

}
function getAsrMode(){

			var item = null;
			var obj = document.getElementsByName("asr_mode");
			for (var i = 0; i < obj.length; i++) { //遍历Radio
				if (obj[i].checked) {
					item = obj[i].value;
					break;
				}
		   }
			if(isfilemode)
			{
				item= "offline";
			}
		   console.log("asr mode"+item);

		   return item;
}

function handleWithTimestamp(tmptext,tmptime)
{
	console.log( "tmptext: " + tmptext);
	console.log( "tmptime: " + tmptime);
	if(tmptime==null || tmptime=="undefined" || tmptext.length<=0)
	{
		return tmptext;
	}
	tmptext=tmptext.replace(/。|？|，|、|\?|\.|\ /g, ","); // in case there are a lot of "。"
	var words=tmptext.split(",");  // split to chinese sentence or english words
	var jsontime=JSON.parse(tmptime); //JSON.parse(tmptime.replace(/\]\]\[\[/g, "],[")); // in case there are a lot segments by VAD
	var char_index=0; // index for timestamp
	var text_withtime="";
	for(var i=0;i<words.length;i++)
	{
	if(words[i]=="undefined"  || words[i].length<=0)
	{
		continue;
	}
	console.log("words===",words[i]);
	console.log( "words: " + words[i]+",time="+jsontime[char_index][0]/1000);
	if (/^[a-zA-Z]+$/.test(words[i]))
	{   // if it is english
		text_withtime=text_withtime+jsontime[char_index][0]/1000+":"+words[i]+"\n";
		char_index=char_index+1;  //for english, timestamp unit is about a word
	}
	else{
		// if it is chinese
		text_withtime=text_withtime+jsontime[char_index][0]/1000+":"+words[i]+"\n";
		char_index=char_index+words[i].length; //for chinese, timestamp unit is about a char
	}
	}
	return text_withtime;
}
// ========== 纠错特效开关 ==========
function isCorrectionEffectOn() {
    var obj = document.getElementsByName("correction_effect");
    for (var i = 0; i < obj.length; i++) {
        if (obj[i].checked) {
            return obj[i].value === "on";
        }
    }
    return true; // 默认开启
}

// ========== 纠错特效：文字差异高亮 ==========
function diffWords(oldText, newText) {
    // 简单逐字对比，返回新文本中被改变的位置区间
    var changes = [];
    var maxLen = Math.max(oldText.length, newText.length);
    var i = 0;

    while (i < maxLen) {
        if (oldText[i] !== newText[i]) {
            var start = i;
            // 找到连续不同的块
            while (i < maxLen && oldText[i] !== newText[i]) {
                i++;
            }
            // 向后多取几个字让高亮更自然（中文词边界）
            var end = Math.min(i + 2, newText.length);
            if (start < newText.length) {
                changes.push({ start: start, end: end });
            }
        }
        i++;
    }
    return changes;
}

function highlightCorrections(element, oldText, newText) {
    var changes = diffWords(oldText, newText);
    if (changes.length === 0) {
        element.textContent = newText;
        return;
    }

    // 构建带高亮的 HTML
    var html = '';
    var cursor = 0;
    for (var c = 0; c < changes.length; c++) {
        var ch = changes[c];
        // 合并相邻/重叠的变化块
        if (c > 0 && ch.start <= changes[c-1].end + 1) {
            // 扩展上一个块的结束位置
            var prevEnd = html.lastIndexOf('</span>');
            var extendedEnd = Math.max(ch.end, changes[c-1].end);
            // 简化处理：重建
            changes[c-1].end = Math.max(changes[c-1].end, ch.end);
            // 重新计算 cursor
            cursor = changes[c-1].start;
            // 移除上一个 span 的内容，重新构建
            var lastSpanStart = html.lastIndexOf('<span class="text-corrected">');
            html = html.substring(0, lastSpanStart);
            // 把上个块的 start 到当前块的 end 都放入高亮
            html += '<span class="text-corrected">' +
                escapeHTML(newText.substring(changes[c-1].start, changes[c-1].end)) +
                '</span>';
            cursor = changes[c-1].end;
            continue;
        }

        // 变化前的普通文本
        if (cursor < ch.start) {
            html += escapeHTML(newText.substring(cursor, ch.start));
        }
        // 高亮变化文本
        html += '<span class="text-corrected">' +
            escapeHTML(newText.substring(ch.start, ch.end)) +
            '</span>';
        cursor = ch.end;
    }
    // 剩余文本
    if (cursor < newText.length) {
        html += escapeHTML(newText.substring(cursor));
    }

    element.innerHTML = html;
}

function escapeHTML(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

function applyCorrectionEffect(transcriptionBody, badge, oldText, newText) {
    // 检查特效开关
    if (!isCorrectionEffectOn()) {
        transcriptionBody.textContent = newText;
        return;
    }

    // 1. 高亮被纠正的文字（仅对变化的文字生效）
    highlightCorrections(transcriptionBody, oldText, newText);

    // 2. 徽章脉冲动画
    badge.classList.remove('badge-correcting');
    void badge.offsetWidth;
    badge.classList.add('badge-correcting');
}

// ========== 语音识别结果处理 ==========
function getJsonMessage(jsonMsg) {
	var msg = JSON.parse(jsonMsg.data);
	var text = msg.text || "";
	var mode = msg.mode || "";
	var transcriptionBody = document.getElementById('transcriptionBody');
		var badge = document.getElementById('recognitionBadge');

	/*
	 * 实时识别
	 */
	if(mode=="2pass-online"){
		// 注意：
		// online实时结果追加，不覆盖

		online_text+=text;
		rec_text =
			offline_text +
			online_text;
		transcriptionBody.textContent = rec_text;
			badge.textContent = '实时识别中…';
			badge.style.background = '#eff6ff';
			badge.style.color = '#1d4ed8';
		console.log(
			"online:",
			online_text
		);

		// 2pass模式：根据用户配置决定是否在online阶段触发意图识别
		// 默认：both（实时+纠错都触发）
		// 可选：offline_only（仅纠错后触发，避免重复和不准确）
		var triggerMode = document.querySelector('input[name="intent_trigger_mode"]:checked');
		var shouldTrigger = triggerMode && triggerMode.value === 'both';

		if (shouldTrigger && text && text.trim() && typeof callIntentService === 'function') {
			callIntentService(text.trim());
		}
	}
	/*
	 * 二次校验结果
	 */
	else if(mode=="2pass-offline"){
		// 标点模型将句间标点放在片段开头，保留它们而不是删除
		// 否则所有句间标点（，。！？）都会被错误丢弃
		// 保存纠错前的显示文本用于对比
		var oldDisplayText = rec_text;
		// offline结果替换当前online
		offline_text += text;
		online_text="";
		rec_text=offline_text;
		// 应用纠错特效：波纹扫描 + 差异高亮 + 粒子闪光
		if (oldDisplayText && oldDisplayText !== rec_text) {
			applyCorrectionEffect(transcriptionBody, badge, oldDisplayText, rec_text);
		} else {
			transcriptionBody.textContent = rec_text;
		}
			badge.textContent = '已纠错';
			badge.style.background = '#ecfdf5';
			badge.style.color = '#059669';

		console.log(
			"offline:",
			offline_text
		);

		// 对纠错后的文本调用意图识别
		if (text && text.trim() && typeof callIntentService === 'function') {
			callIntentService(text.trim());
		}
	}

	/*
	 * 普通offline（文件模式转写结果）
	 * 文件模式下 VAD 会切出多段，每段一条 offline 消息 → 累积拼接
	 * 服务端在最后一段会带 is_final:true，用于触发完成状态
	 * 麦克风 offline 模式 → 直接替换（每次是新一句话）
	 */
	else if(mode=="offline"){
		if (isfilemode) {
			// 文件模式：多段累积，写入文件专属展示区
			if (offline_text.length > 0) {
				offline_text += "\n" + text;
			} else {
				offline_text = text;
			}
			rec_text = offline_text;

			// 写入文件转写结果区
			var fileBody = document.getElementById('fileTranscriptionBody');
			fileBody.textContent = rec_text;

			// 检测 is_final 判断是否最后一段
			var isFinal = msg.is_final === true || msg.is_final === "true";
			var fileBadge = document.getElementById('fileRecognitionBadge');
			if (isFinal) {
				file_send_complete = true;
				fileBadge.textContent = '转写完成';
				fileBadge.style.background = '#ecfdf5';
				fileBadge.style.color = '#059669';
				info_div.innerHTML = '识别完成，可重新选择文件上传';
				// 服务端随后会断开，提前解锁按钮
				btnConnect.disabled = false;
				btnStart.disabled = true;
				btnStop.disabled = true;
			} else {
				fileBadge.textContent = '转写中…';
				fileBadge.style.background = '#eff6ff';
				fileBadge.style.color = '#1d4ed8';
			}

			// 对文件转写结果调用意图识别
			if (text && text.trim() && typeof callIntentService === 'function') {
				callIntentService(text.trim());
			}
		} else {
			offline_text = text;
			rec_text = text;

			transcriptionBody.textContent = rec_text;
			badge.textContent = '转写完成';
			badge.style.background = '#ecfdf5';
			badge.style.color = '#059669';
			file_send_complete = true;

			// 对麦克风offline结果调用意图识别
			if (text && text.trim() && typeof callIntentService === 'function') {
				callIntentService(text.trim());
			}
		}
	}

	/*
	 * online模式
	 */
	else if(mode=="online"){
		online_text+=text;

		rec_text=online_text;

		transcriptionBody.textContent = rec_text;
			badge.textContent = '实时识别中…';
			badge.style.background = '#eff6ff';
			badge.style.color = '#1d4ed8';

		// 对online模式结果调用意图识别
		if (text && text.trim() && typeof callIntentService === 'function') {
			callIntentService(text.trim());
		}
	}

	// 文字增多时自动滚动到底部，保证最新识别结果始终可见
	autoScrollTranscription();
}

// 若用户已在（或接近）底部，则跟随滚动到最新内容；
// 若用户主动向上滚动查看历史，则不打扰
function autoScrollTranscription() {
	var el = isfilemode
		? document.getElementById('fileTranscriptionBody')
		: document.getElementById('transcriptionBody');
	if (!el) return;
	var nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
	if (nearBottom) {
		el.scrollTop = el.scrollHeight;
	}
}

// 连接状态响应
function getConnState( connState ) {
	if ( connState === 0 ) { //on open
		is_ws_connected = true;
		info_div.innerHTML='连接成功!请点击开始';
		var badge = document.getElementById('recognitionBadge');
		badge.textContent = '已连接';
		badge.style.background = '#ecfdf5';
		badge.style.color = '#059669';
		if (isfilemode==true){
			// 隐藏实时转写卡片，显示文件转写结果区
			document.getElementById('mic_transcription_card').style.display = 'none';

			document.getElementById('file_result_area').style.display = 'block';
			var fileBadge = document.getElementById('fileRecognitionBadge');
			fileBadge.textContent = '等待转写';
			fileBadge.style.background = '#e8f0fe';
			fileBadge.style.color = '#1a73e8';

			// 若点击「开始」触发的自动连接：配置帧已在 onOpen 发送，立即推送音频
			if (_pending_action === 'file') {
				_pending_action = null;
				if (file_data_array && file_data_array.byteLength > 0) {
					info_div.innerHTML = '正在上传文件转写，请耐心等待...';
					fileBadge.textContent = '上传中…';
					fileBadge.style.background = '#eff6ff';
					fileBadge.style.color = '#1d4ed8';
					btnStart.disabled = true;
					btnStop.disabled = false;
					btnConnect.disabled = true;
					start_file_send();
					return;
				}
			}

			if (file_data_array && file_data_array.byteLength > 0) {
				info_div.innerHTML='连接成功，请点击「开始」上传转写';
				btnStart.disabled = false;
				btnStop.disabled = true;
				btnConnect.disabled = true;
			} else {
				info_div.innerHTML='已连接，请选择音频文件上传';
				btnConnect.disabled = true;
			}
		}
		else
		{
			btnStart.disabled = false;
			btnStop.disabled = true;
			btnConnect.disabled=true;
		}
	} else if ( connState === 1 ) {
		is_ws_connected = false;
		// onClose: 文件模式下服务端发完所有段后主动断开 → 转写完成
		if (isfilemode && !file_send_complete) {
			file_send_complete = true;
			var fileBadge = document.getElementById('fileRecognitionBadge');
			fileBadge.textContent = '转写完成';
			fileBadge.style.background = '#ecfdf5';
			fileBadge.style.color = '#059669';
			btnStart.disabled = true;
			btnStop.disabled = true;
			btnConnect.disabled = false;
			info_div.innerHTML = '识别完成，可重新选择文件上传';
			console.log("file mode: server closed connection, transcribe complete");
		}
	} else if ( connState === 2 ) {
		is_ws_connected = false;
		_pending_action = null;
		stop();
		console.log( 'connecttion error' );

		alert("连接地址"+document.getElementById('wssip').value+"失败,请检查asr地址和端口。或试试界面上手动授权，再连接。");
		btnStart.disabled = true;
		btnStop.disabled = true;
		btnConnect.disabled=false;
		info_div.innerHTML='请点击连接';
	}
}

function record()
{

		 rec.open( function(){
		 rec.start();
		 console.log("开始");
			btnStart.disabled = true;
			btnStop.disabled = false;
			btnConnect.disabled=true;
		 });

}

// 识别启动、停止、清空操作
function start() {

	// 清除显示
	clear();
	// 重置文件发送状态
	file_send_complete = false;
	file_send_aborted = false;
	//控件状态更新
	console.log("isfilemode"+isfilemode);

	//启动连接
	var ret=wsconnecter.wsStart();
	// 1 is ok, 0 is error
	if(ret==1){
		info_div.innerHTML="正在连接asr服务器，请等待...";
		isRec = true;
		btnStart.disabled = true;
		btnStop.disabled = true;
		btnConnect.disabled=true;

		return 1;
	}
	else
	{
		info_div.innerHTML="请点击开始";
		btnStart.disabled = true;
		btnStop.disabled = true;
		btnConnect.disabled=false;

		return 0;
	}
}
function stop() {
		// 文件模式：用户主动停止 → 中止上传/识别
		if (isfilemode) {
			file_send_aborted = true;
			_pending_action = null;
			isRec = false;
			info_div.innerHTML = '已停止，可重新选择文件上传';
			btnStart.disabled = true;
			btnStop.disabled = true;
			// 更新文件转写状态
			var fileBadge = document.getElementById('fileRecognitionBadge');
			fileBadge.textContent = '已中止';
			fileBadge.style.background = '#fef2f2';
			fileBadge.style.color = '#dc2626';
			setTimeout(function() {
				console.log("file mode: user stop, closing ws");
				wsconnecter.wsStop();
				btnConnect.disabled = false;
				if (file_data_array && file_data_array.byteLength > 0) {
					btnStart.disabled = false;
				}
			}, 500);
			return;
		}

		var chunk_size = new Array( 5, 10, 5 );
		var request = {
			"chunk_size": chunk_size,
			"wav_name":  "h5",
			"is_speaking":  false,
			"chunk_interval":10,
			"mode":getAsrMode(),
		};
		console.log(request);
		if(sampleBuf.length>0){
		wsconnecter.wsSend(sampleBuf);
		console.log("sampleBuf.length"+sampleBuf.length);
		sampleBuf=new Int16Array();
		}
	   wsconnecter.wsSend( JSON.stringify(request) );
	// 控件状态更新

	isRec = false;
		info_div.innerHTML="发送完数据,请等候,正在识别...";

   if(isfilemode==false){
		btnStop.disabled = true;
		btnStart.disabled = true;
		btnConnect.disabled=true;
		//wait 3s for asr result
	  setTimeout(function(){
		console.log("call stop ws!");
		wsconnecter.wsStop();
		btnConnect.disabled=false;
		info_div.innerHTML="请点击连接";}, 3000   );

		rec.stop(function(blob,duration){

			console.log(blob);
			var audioBlob = Recorder.pcm2wav(data = {sampleRate:16000, bitRate:16, blob:blob},
			function(theblob,duration){
					console.log(theblob);
			var audio_record = document.getElementById('audio_record');
			audio_record.src =  (window.URL||webkitURL).createObjectURL(theblob);
			audio_record.controls=true;
			//audio_record.play();

		}   ,function(msg){
			 console.log(msg);
		}
			);
		},function(errMsg){
			console.log("errMsg: " + errMsg);
		});
	}
	else
	{
		// 文件模式：等待服务端返回结果后恢复按钮
		setTimeout(function(){
			console.log("file mode: reset after stop");
			wsconnecter.wsStop();
			btnConnect.disabled=false;
			info_div.innerHTML="识别完成，可重新选择文件上传";
		}, 5000);
	}
	// 停止连接
}

function clear() {

	var transcriptionBody = document.getElementById('transcriptionBody');
	var badge = document.getElementById('recognitionBadge');

	transcriptionBody.textContent = "";
	badge.textContent = '待连接';
	badge.style.background = '#e8f0fe';
	badge.style.color = '#1a73e8';

	// 清空文件转写结果区
	var fileBody = document.getElementById('fileTranscriptionBody');
	fileBody.textContent = "";
	var fileBadge = document.getElementById('fileRecognitionBadge');
	fileBadge.textContent = '等待转写';
	fileBadge.style.background = '#e8f0fe';
	fileBadge.style.color = '#1a73e8';

	rec_text="";
	offline_text="";
	prev_display_text="";
	// 重置文件状态
	file_send_complete = false;
	file_send_aborted = false;

}
function recProcess( buffer, powerLevel, bufferDuration, bufferSampleRate,newBufferIdx,asyncEnd ) {
	if ( isRec === true ) {
		var data_48k = buffer[buffer.length-1];

		var  array_48k = new Array(data_48k);
		var data_16k=Recorder.SampleData(array_48k,bufferSampleRate,16000).data;

		sampleBuf = Int16Array.from([...sampleBuf, ...data_16k]);
		var chunk_size=960; // for asr chunk_size [5, 10, 5]
		info_div.innerHTML=""+bufferDuration/1000+"s";
		while(sampleBuf.length>=chunk_size){
			sendBuf=sampleBuf.slice(0,chunk_size);
			sampleBuf=sampleBuf.slice(chunk_size,sampleBuf.length);
			wsconnecter.wsSend(sendBuf);
		}
	}
}

function getUseITN() {
	var obj = document.getElementsByName("use_itn");
	for (var i = 0; i < obj.length; i++) {
		if (obj[i].checked) {
			return obj[i].value === "true";
		}
	}
	return false;
}
