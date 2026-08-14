# AI助教机2.0语音控制需求 !!! 纯规则 不走大模型

# 解决跨域问题

# conda activate base

# nohup python jyd_intentV1.py  > logs/8024.log 2>&1 &

# 怀来 120.211.237.163/app-8ixHPWXYG9tnSCEoH685aMWF

# 149 188.18.18.149/app-MWrE04oEPloukfxztcATJfbo


"""

服务开机自启，你可以直接运行安装脚本（会提示输入密码）：

cd /opt/jyd01/wangruihua/AI_Tutor
./setup_service.sh
安装完成后，可以用以下命令查看日志：


tail -f /opt/jyd01/wangruihua/AI_Tutor/logs/8024.log

"""

import re
from typing import Any, Dict, Optional, Tuple, Callable, List
import time
import json
import logging
import sys
import traceback
import os
from logging.handlers import RotatingFileHandler

from flask import Flask, request, Response, jsonify
from flask_cors import CORS


# =========================
# Base paths
# =========================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))


# =========================
# Remote model config - REMOVED (Rule-based matching only)
# =========================


# =========================
# Logging
# =========================
LOG_DIR = os.path.join(BASE_DIR, "logs")
os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE = os.path.join(LOG_DIR, "intent_server_V1.log")

logger = logging.getLogger("intent_server")
logger.setLevel(logging.INFO)
logger.propagate = False

if not logger.handlers:
    formatter = logging.Formatter(
        "[%(asctime)s] [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(formatter)

    file_handler = RotatingFileHandler(
        LOG_FILE,
        maxBytes=10 * 1024 * 1024,   # 10MB
        backupCount=5,
        encoding="utf-8"
    )
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(formatter)

    logger.addHandler(console_handler)
    logger.addHandler(file_handler)

logger.info("========== intent server logging started ==========")
logger.info(f"Base dir: {BASE_DIR}")
logger.info(f"Mode: Rule-based matching only (LLM disabled)")
logger.info(f"Log file: {LOG_FILE}")


# =========================
# Regex constants (removed unused _RELAXED_INTENT_RE)
# =========================
_VIDEO_INDEX_RE = re.compile(r"第\s*([0-9零一二两三四五六七八九十百千半]+)\s*个(?:\s*视频)?")

_DATE_TIME_RE = re.compile(
    r"(?:"
    r"(?P<y1>\d{4})\s*年\s*(?P<mo1>\d{1,2})\s*月\s*(?P<d1>\d{1,2})\s*(?:日|号)"
    r"|"
    r"(?P<y2>\d{4})-(?P<mo2>\d{1,2})-(?P<d2>\d{1,2})"
    r")"
    r"(?:\s*(?:"
    r"(?P<h1>\d{1,2})\s*(?:点|时)"
    r"(?:\s*(?P<mi1>\d{1,2})\s*分)?"
    r"(?:\s*(?P<s1>\d{1,2})\s*秒)?"
    r"|"
    r"(?P<h2>\d{1,2})"
    r"(?:\s*[:：]\s*(?P<mi2>\d{1,2}))?"
    r"(?:\s*[:：]\s*(?P<s2>\d{1,2}))?"
    r"))?"
)

_CN_NUM = {
    "零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5,
    "六": 6, "七": 7, "八": 8, "九": 9
}

_TIME_UNIT_MAP = {
    "秒": "SECOND",
    "秒钟": "SECOND",
    "s": "SECOND",
    "S": "SECOND",
    "sec": "SECOND",
    "分": "MINUTE",
    "分钟": "MINUTE",
    "min": "MINUTE",
    "m": "MINUTE",
    "时": "HOUR",
    "小时": "HOUR",
    "h": "HOUR",
    "H": "HOUR",
}

_TIME_PATTERN = re.compile(
    r"(?P<num>(?:\d+(?:\.\d+)?)|[零一二两三四五六七八九十百千半]+)\s*"
    r"(?P<unit>小时|时|分钟|分|秒钟|秒|[sSmMhH]|sec|min)"
)

# 跳转到指定时间点的正则 (Intent 29) - 支持阿拉伯数字和中文数字
_JUMP_TO_TIME_RE = re.compile(
    r"跳到?(?:第\s*)?(?P<min>(?:\d+)|[零一二两三四五六七八九十百千半]+)\s*分(?:钟)?(?:\s*(?P<sec>(?:\d+)|[零一二两三四五六七八九十百千半]+)\s*秒)?"
)

# 播放速度的正则 (Intent 30)，"点"用于中文小数如"零点五"
_PLAYBACK_SPEED_RE = re.compile(
    r"(?P<speed>(?:\d+(?:\.\d+)?)|[零一二两三四五六七八九十百千半点]+)\s*倍速?"
)

# 台词跳转的正则 (Intent 41)
_LYRIC_JUMP_RE = re.compile(
    r"(?:跳转到|从|播放)?\s*['\"](?P<lyric>[^'\"]+)['\"]"
)

# 无引号的台词跳转正则 - 支持"播放XXX"和"播放XXX这句"
_LYRIC_JUMP_NO_QUOTE_RE = re.compile(
    r"(?:跳转到|从|播放)\s*(?P<lyric>.+?)(?:\s*(?:这句|那句))?$"
)


# =========================
# Utils
# =========================
def normalize_text(text: str) -> str:
    """
    去空白，便于硬规则匹配
    """
    return re.sub(r"\s+", "", text).strip()


def chinese_to_number(s: str):
    s = s.strip()
    if not s:
        return None
    if s == "半":
        return 0.5
    if re.fullmatch(r"\d+(\.\d+)?", s):
        return float(s) if "." in s else int(s)

    if any(u in s for u in ["十", "百", "千"]):
        total = 0
        current = 0
        for ch in s:
            if ch in _CN_NUM:
                current = _CN_NUM[ch]
            elif ch == "十":
                total += (current if current != 0 else 1) * 10
                current = 0
            elif ch == "百":
                total += (current if current != 0 else 1) * 100
                current = 0
            elif ch == "千":
                total += (current if current != 0 else 1) * 1000
                current = 0
            elif ch == "半":
                current += 0.5
        total += current
        return total

    # 处理中文小数，如"零点五" → 0.5，"一点五" → 1.5
    if "点" in s:
        parts = s.split("点", 1)
        int_str, dec_str = parts[0], parts[1]
        int_val = chinese_to_number(int_str) if int_str else 0
        if int_val is None:
            int_val = 0
        dec_val = 0.0
        for i, ch in enumerate(dec_str):
            d = _CN_NUM.get(ch)
            if d is None:
                try:
                    d = int(ch)
                except (ValueError, TypeError):
                    break
            dec_val += d * (0.1 ** (i + 1))
        return float(int_val) + dec_val

    return _CN_NUM.get(s, None)


def parse_video_datetime(text: str) -> Optional[str]:
    """
    返回 time_pb:
    - 只有日期 -> "YYYY-MM-DD"
    - 含时间 -> "YYYY-MM-DD HH:MM:SS"
    """
    m = _DATE_TIME_RE.search(text)
    if not m:
        return None

    y = int(m.group("y1") or m.group("y2"))
    mo = int(m.group("mo1") or m.group("mo2"))
    d = int(m.group("d1") or m.group("d2"))

    h = mi = s = None

    if m.group("h1") is not None:
        h = int(m.group("h1"))
        mi = int(m.group("mi1")) if m.group("mi1") is not None else 0
        s = int(m.group("s1")) if m.group("s1") is not None else 0
    elif m.group("h2") is not None:
        h = int(m.group("h2"))
        mi = int(m.group("mi2")) if m.group("mi2") is not None else 0
        s = int(m.group("s2")) if m.group("s2") is not None else 0

    if h is None:
        return f"{y:04d}-{mo:02d}-{d:02d}"
    return f"{y:04d}-{mo:02d}-{d:02d} {h:02d}:{mi:02d}:{s:02d}"


def extract_video_index(text: str) -> Optional[int]:
    m = _VIDEO_INDEX_RE.search(text)
    if not m:
        return None

    idx_raw = m.group(1)
    idx = chinese_to_number(idx_raw)
    if idx is None:
        return None

    try:
        return int(idx)
    except (TypeError, ValueError):
        return None


# LLM-related functions removed - using rule-based matching only


def extract_seek_info(text: str) -> Tuple[Optional[int], Optional[str]]:
    m = _TIME_PATTERN.search(text)
    if not m:
        return None, None

    num_str = m.group("num")
    unit_str = m.group("unit")
    value = chinese_to_number(num_str)
    unit = _TIME_UNIT_MAP.get(unit_str)

    if value is None or unit is None:
        return None, None

    value_int = int(round(value)) if isinstance(value, float) else int(value)
    return value_int, unit


def extract_jump_time(text: str) -> Optional[Dict[str, int]]:
    """提取跳转时间点 (Intent 29) - 支持阿拉伯数字和中文数字"""
    m = _JUMP_TO_TIME_RE.search(text)
    if not m:
        return None

    min_str = m.group("min")
    sec_str = m.group("sec")

    # 转换分钟（支持中文数字）
    minutes = chinese_to_number(min_str)
    if minutes is None:
        return None
    minutes = int(minutes)

    # 转换秒数（支持中文数字）
    seconds = 0
    if sec_str:
        sec_num = chinese_to_number(sec_str)
        if sec_num is not None:
            seconds = int(sec_num)

    return {"minutes": minutes, "seconds": seconds}


def extract_playback_speed(text: str) -> Optional[float]:
    """提取播放速度 (Intent 30)"""
    # 特殊关键词
    if contains_any(text, ["慢放", "慢速"]):
        return 0.5
    if contains_any(text, ["正常速度", "正常播放", "1倍速", "一倍速"]):
        return 1.0
    if contains_any(text, ["快放", "快速"]):
        return 1.5

    # 数字倍速（支持阿拉伯数字和中文数字）
    m = _PLAYBACK_SPEED_RE.search(text)
    if m:
        speed_str = m.group("speed")
        # 尝试转换中文数字
        speed_num = chinese_to_number(speed_str)
        if speed_num is not None:
            return float(speed_num)

    return None


def extract_lyric_text(text: str) -> Optional[str]:
    """提取台词文本 (Intent 41)"""
    # 优先匹配带引号的台词
    m = _LYRIC_JUMP_RE.search(text)
    if m:
        lyric = m.group("lyric")
        # 移除所有标点符号
        lyric = re.sub(r'[^\w\s]', '', lyric)
        return lyric.strip()

    # 匹配无引号的台词："跳转到XXX这句"
    m = _LYRIC_JUMP_NO_QUOTE_RE.search(text)
    if m:
        lyric = m.group("lyric").strip()
        # 移除所有标点符号
        lyric = re.sub(r'[^\w\s]', '', lyric)
        return lyric.strip()

    return None


# =========================
# Hard rules
# =========================
def contains_any(text: str, patterns: List[str]) -> bool:
    return any(p in text for p in patterns)


def contains_all(text: str, patterns: List[str]) -> bool:
    return all(p in text for p in patterns)


def match_hard_rule(raw_text: str) -> Optional[Dict[str, Any]]:
    """
    高频、明确、无需 LLM 推理的命令，直接硬规则返回
    优先级从高到低匹配，避免误判
    """
    text = normalize_text(raw_text)

    # ============================================================
    # 优先级1: 具体功能的关闭/退出 (优先于通用退出)
    # ============================================================
    # Intent 8: 关闭回放
    if contains_any(text, ["关闭回放", "关掉回放", "退出回放"]):
        return {"intent_id": 8}

    # Intent 13: 关闭批注
    if contains_any(text, ["关闭批注", "关掉批注", "退出批注"]):
        return {"intent_id": 13}

    # Intent 17: 关闭投屏
    if contains_any(text, ["关闭投屏", "关掉投屏", "退出投屏"]):
        return {"intent_id": 17}

    # ============================================================
    # 优先级2: 通用退出/关闭 (Intent 18)
    # ============================================================
    if contains_any(text, ["退下", "再见", "拜拜"]):
        return {"intent_id": 18}

    # "退出"单独出现时才是退出AI
    if text == "退出":
        return {"intent_id": 18}

    # "关闭"需要判断具体关闭什么
    if "关闭" in text:
        if contains_any(text, ["回放", "播放", "视频"]):
            return {"intent_id": 8}  # 关闭回放
        elif contains_any(text, ["批注"]):
            return {"intent_id": 13}  # 关闭批注
        elif contains_any(text, ["投屏"]):
            return {"intent_id": 17}  # 关闭投屏
        elif contains_any(text, ["字幕"]):
            return {"intent_id": 28}  # 关闭字幕
        elif contains_any(text, ["镜像"]):
            return {"intent_id": 40}  # 关闭镜像
        elif contains_any(text, ["伴奏"]):
            return {"intent_id": 37}  # 关闭伴奏（切换到正常模式）
        elif not contains_any(text, ["录制", "录像", "白板", "互动", "课程", "U盘"]):
            return {"intent_id": 18}  # 退出AI

    # ============================================================
    # 优先级3: 录制相关 (Intent 1-4)
    # ============================================================
    # Intent 1: 开始录制
    # 注意: 排除"回放"，避免"打开录制回放"命中"打开录制"被误判为开始录制
    if "回放" not in text and contains_any(text, ["开始录制", "开启录像", "开始录像", "启动录制", "启动录像", "打开录像", "打开即时录播",
                            "打开录制", "开启录制", "打开录播", "开始录播"]):
        return {"intent_id": 1}

    # Intent 2: 暂停录制
    if contains_any(text, ["暂停录制", "暂停录像", "暂时停止录制", "等会再录"]):
        return {"intent_id": 2}

    # Intent 3: 结束录制
    if contains_any(text, ["停止录像", "录完了", "结束录制", "结束录像", "终止录像", "终止录制"]):
        return {"intent_id": 3}
    if "结束" in text and not contains_any(text, ["播放", "回放", "视频"]):
        return {"intent_id": 3}

    # Intent 4: 继续录制
    if contains_any(text, ["继续录制", "继续录像"]):
        return {"intent_id": 4}

    # ============================================================
    # 优先级4: 回放相关 (Intent 5-7)
    # ============================================================
    # Intent 5: 打开回放模块
    if contains_any(text, ["我要看回放", "打开之前的视频", "打开回放", "开始回放", "开启回放", "查看回放", "打开课程回放",
                            "打开回看", "开始回看", "开启回看", "查看回看", "我要看回看", "回看"]):
        return {"intent_id": 5}

    # Intent 6: 暂停播放
    if contains_any(text, ["暂停播放", "停止播放", "中断播放", "停一下"]):
        return {"intent_id": 6}
    if "暂停" in text and not contains_any(text, ["录制", "录像"]):
        return {"intent_id": 6}

    # Intent 7: 继续播放
    if contains_any(text, ["继续播放", "开始播放"]):
        return {"intent_id": 7}
    # "播放"需要排除镜像、台词跳转等特殊情况
    if "播放" in text and not contains_any(text, ["暂停", "停止", "关闭", "速度", "镜像", "翻转"]):
        # 检查是否是台词跳转模式：播放 + 具体内容
        # 如果"播放"后面跟着实际内容（不只是"这句"/"那句"），则可能是台词跳转
        text_after_play = text.replace("播放", "", 1).strip()
        # 如果有引号，肯定是台词跳转
        has_quote = ("'" in text or '"' in text or "'" in text or "'" in text or
                     """ in text or """ in text)
        # 如果"播放"后面有实质内容（长度>1且不只是"这句"/"那句"），可能是台词跳转，跳过Intent 7
        is_lyric_pattern = (text_after_play and len(text_after_play) > 1 and
                           text_after_play not in ["这句", "那句"])

        if not has_quote and not is_lyric_pattern:
            return {"intent_id": 7}

    # ============================================================
    # 优先级5: 快进/回退 (Intent 9-10)
    # ============================================================
    # Intent 9: 快进
    if contains_any(text, ["快进", "往后", "向后"]):
        data = {"intent_id": 9}
        seek_time, unit = extract_seek_info(text)
        if seek_time is not None and unit is not None:
            data["seek_time"] = seek_time
            data["unit"] = unit
        return data

    # Intent 10: 回退
    if contains_any(text, ["往前", "向前", "回退", "往回", "后退", "往前退", "退回"]):
        data = {"intent_id": 10}
        seek_time, unit = extract_seek_info(text)
        if seek_time is not None and unit is not None:
            data["seek_time"] = seek_time
            data["unit"] = unit
        return data

    # ============================================================
    # 优先级6: 白板/批注 (Intent 11-12)
    # ============================================================
    # Intent 11: 打开白板
    if contains_any(text, ["进入白板", "我要写字", "打开白板", "启动白板", "开启白板"]):
        return {"intent_id": 11}

    # Intent 12: 打开批注
    if contains_any(text, ["打开批注", "开启批注", "开始批注", "启动批注"]):
        return {"intent_id": 12}

    # ============================================================
    # 优先级7: 其他功能 (Intent 14-19)
    # ============================================================
    # Intent 14: 远程互动
    if contains_any(text, ["打开远程互动", "开启远程互动", "开始远程互动", "启动远程互动"]):
        return {"intent_id": 14}

    # Intent 15: 打开国戏课程
    if contains_any(text, ["打开国戏课程", "开启国戏课程", "国戏课程"]):
        return {"intent_id": 15}

    # Intent 16: 打开投屏
    if contains_any(text, ["打开投屏", "开启投屏", "开始投屏", "启动投屏"]):
        return {"intent_id": 16}

    # Intent 19: 打开U盘
    if contains_any(text, ["打开U盘", "打开u盘", "打开优盘", "打开移动盘"]):
        return {"intent_id": 19}

    # ============================================================
    # 优先级8: 录制状态查询 (Intent 23-24)
    # ============================================================
    # Intent 23: 查询录制状态
    if contains_any(text, ["现在在录吗", "录制开了吗", "有没有在录制", "有没有在录", "正在录制吗", "在录吗"]):
        return {"intent_id": 23}

    # Intent 24: 查询录制时长
    if contains_any(text, ["录多久了", "录制了多长时间", "录制多长时间了", "录了多久"]):
        return {"intent_id": 24}

    # ============================================================
    # 优先级9: 回放Tab切换 (Intent 25)
    # ============================================================
    # Intent 25: 切换回放tab
    if contains_any(text, ["切换到课堂课程", "看录制回放", "切换到录制回放", "课堂课程", "录制回放"]):
        data = {"intent_id": 25}
        # 判断具体切换到哪个tab
        if contains_any(text, ["录制回放", "切换到录制回放", "看录制回放"]):
            data["pb_tab"] = 1  # 录制回放
        elif contains_any(text, ["课堂课程", "切换到课堂课程"]):
            data["pb_tab"] = 2  # 课堂课程
        return data

    # ============================================================
    # 优先级10: 删除回放 (Intent 26)
    # ============================================================
    # Intent 26: 删除回放记录
    if contains_any(text, ["删除这个回放", "删除回放", "删掉回放"]):
        return {"intent_id": 26}

    # 删除第X个视频
    if "删" in text and "视频" in text:
        idx = extract_video_index(text)
        if idx is not None:
            return {"intent_id": 26, "index_pb": int(idx)}

    # ============================================================
    # 优先级11: AI字幕 (Intent 27-28)
    # ============================================================
    # Intent 27: 开启AI字幕
    if contains_any(text, ["打开字幕", "开启AI字幕", "显示字幕", "开启字幕"]):
        return {"intent_id": 27}

    # Intent 28: 关闭AI字幕
    if contains_any(text, ["关闭字幕", "关掉AI字幕", "隐藏字幕", "关掉字幕"]):
        return {"intent_id": 28}

    # ============================================================
    # 优先级12: 跳转至指定时间点 (Intent 29)
    # ============================================================
    # Intent 29: 跳转至指定时间点
    jump_time = extract_jump_time(text)
    if jump_time is not None:
        return {"intent_id": 29, "minutes": jump_time["minutes"], "seconds": jump_time["seconds"]}

    # ============================================================
    # 优先级13: 调节播放速度 (Intent 30)
    # ============================================================
    # Intent 30: 调节播放速度
    speed = extract_playback_speed(text)
    if speed is not None:
        return {"intent_id": 30, "speed": speed}

    # ============================================================
    # 优先级14: 音量调节 (Intent 31-32)
    # ============================================================
    # Intent 31: 调高媒体音量
    if contains_any(text, ["声音大一点", "调大音量", "音量调大", "声音调大", "大点声"]):
        return {"intent_id": 31}

    # Intent 32: 调低媒体音量
    if contains_any(text, ["声音小一点", "调小音量", "音量调小", "声音调小", "小点声"]):
        return {"intent_id": 32}

    # ============================================================
    # 优先级15: 课程切换 (Intent 33)
    # ============================================================
    # Intent 33: 切换"我的课程 / 全部课程"
    # gx_pb_tab: 1=我的课程, 2=全部课程
    if contains_any(text, ["我的课程", "看我的课程", "切换到我的课程"]):
        return {"intent_id": 33, "gx_pb_tab": 1}

    if contains_any(text, ["全部课程", "切换到全部课程", "显示全部课程", "看全部课程"]):
        return {"intent_id": 33, "gx_pb_tab": 2}

    # ============================================================
    # 优先级16: 剧种筛选 (Intent 34)
    # ============================================================
    # Intent 34: 按剧种筛选
    # 剧种名称到ID的映射
    drama_type_mapping = {
        "京剧": 1,
        "昆曲": 2,
        "越剧": 3,
        "黄梅戏": 4,
        "评剧": 5,
        "豫剧": 6,
        "川剧": 7,
        "粤剧": 8,
        "秦腔": 9,
        "其他": 10
    }

    # 先检查是否包含剧种名称
    found_genre = None
    found_genre_id = None
    for genre_name, genre_id in drama_type_mapping.items():
        if genre_name in text:
            found_genre = genre_name
            found_genre_id = genre_id
            break

    # 如果包含剧种名称，再检查是否有筛选相关的关键词
    if found_genre and contains_any(text, ["筛选", "挑出", "看", "显示", "找", "搜", "课程", "的课", "剧种"]):
        return {"intent_id": 34, "gx_drama_type": found_genre_id}

    # 兜底：只要包含筛选关键词
    if contains_any(text, ["筛选", "剧种"]):
        return {"intent_id": 34}

    # ============================================================
    # 优先级17: 开始学习 (Intent 36)
    # 注意：必须在搜索课程(35)之前，避免"进入课程"被当成搜索指令
    # ============================================================
    # Intent 36: 开始学习
    if contains_any(text, ["开始学习", "进入课程", "开始上课"]):
        return {"intent_id": 36}

    # ============================================================
    # 优先级18: 切换模式 (Intent 37-38)
    # 注意：必须在搜索课程(35)之前，避免"打开伴奏"被当成搜索指令
    # ============================================================
    # Intent 37: 切换正常模式
    if contains_any(text, ["切换到正常模式", "关闭伴奏", "无声音模式", "正常模式"]):
        return {"intent_id": 37}

    # Intent 38: 切换伴奏模式
    if contains_any(text, ["切换到伴奏模式", "打开伴奏", "有声音模式", "伴奏模式"]):
        return {"intent_id": 38}

    # ============================================================
    # 优先级19: 镜像动作 (Intent 39-40)
    # 注意：必须在搜索课程(35)之前，避免"打开镜像"被当成搜索指令
    # ============================================================
    # Intent 39: 开启镜像动作
    if contains_any(text, ["打开镜像", "开启镜像动作", "翻转播放", "开启镜像"]):
        return {"intent_id": 39}

    # Intent 40: 关闭镜像动作
    if contains_any(text, ["关闭镜像", "关掉镜像动作", "取消翻转", "关掉镜像"]):
        return {"intent_id": 40}

    # ============================================================
    # 优先级20: 台词跳转 (Intent 41)
    # ============================================================
    # Intent 41: 台词跳转
    lyric = extract_lyric_text(text)
    if lyric is not None:
        return {"intent_id": 41, "lyric": lyric}

    # 兜底：包含跳转关键词和"这句/那句"，但无法提取台词
    if contains_any(text, ["跳转到", "开始播", "播放"]) and ("这句" in text or "那句" in text):
        return {"intent_id": 41}

    # ============================================================
    # 优先级21: 搜索课程 (Intent 35)
    # 放在具体功能指令之后，避免"打开伴奏"/"打开镜像"/"进入课程"等被误识别
    # ============================================================
    # Intent 35: 搜索课程
    # 检查是否包含搜索/打开/进入/找等关键词
    search_keywords = ["打开", "进入", "搜索", "找", "找一下", "搜一下", "查找", "查", "大开","看一下"]
    if contains_any(text, search_keywords) or "搜索课程" in text:
        # 提取课程名称 - 移除所有搜索相关的关键词
        course_name = text
        for keyword in search_keywords + ["课程", "一下"]:
            course_name = course_name.replace(keyword, "")
        course_name = course_name.strip()

        # 移除所有标点符号
        course_name = re.sub(r'[^\w\s]', '', course_name)
        course_name = course_name.strip()

        if course_name:
            return {"intent_id": 35, "course_name": course_name}
        return {"intent_id": 35}

    # ============================================================
    # 优先级22: 语音助手唤醒词 (Intent 42)
    # ============================================================
    # Intent 42: 语音助手唤醒词（含各种称呼及发音相似变体）
    # 唤醒词核心："小达/小大/小打/小搭/小塔/小丁"等同音近音词
    _WAKE_CORES = ["小达", "小大内", "小大", "小打", "小搭", "小塔", "小丁",
                   "西澳达", "西奥达", "小奥达"]
    _WAKE_PREFIXES = ["你好", "你好，", "你好,", "好", "好，", "好,", ""]
    _wake_words = [p + c for c in _WAKE_CORES for p in _WAKE_PREFIXES]
    if contains_any(text, _wake_words):
        return {"intent_id": 42}
    # 精确匹配纯唤醒词（避免"小达，播放视频"之类被误拦截）
    if text in _WAKE_CORES or text in ["喂"]:
        return {"intent_id": 42}

    # ============================================================
    # 优先级23: 返回上一级 (Intent 43)
    # ============================================================
    # Intent 43: 返回上一级
    if contains_any(text, ["返回", "回去", "上一页", "返回上一级"]):
        return {"intent_id": 43}

    # ============================================================
    # 优先级24: 继续 (Intent 22 - 需要上下文)
    # ============================================================
    # "继续"单独出现时，返回Intent 22，由上层根据上下文判断
    if text == "继续":
        return {"intent_id": 22}

    return None


def build_intent_service() -> Callable[[Dict[str, Any]], Dict[str, Any]]:
    logger.info("Using rule-based intent matching only (LLM disabled)")

    # 简单的内存缓存，避免重复请求
    cache = {}
    cache_max_size = 1000

    def service(req: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(req, dict):
            logger.warning("Request is not dict")
            return {"code": 400, "message": "param_error", "data": {}}

        text = req.get("text")
        if not isinstance(text, str) or not text.strip():
            logger.warning(f"Invalid text field: {repr(text)}")
            return {"code": 400, "message": "param_error", "data": {}}

        text = text.strip()
        logger.info(f"Incoming text: {repr(text)}")

        # 纯数字不是有效语音指令（如误识别的"26"/"二十六"），直接返回 intent 0
        _norm_text = normalize_text(text)
        if re.fullmatch(r"\d+", _norm_text) or (
            re.fullmatch(r"[零一二两三四五六七八九十百千]+", _norm_text)
            and chinese_to_number(_norm_text) is not None
        ):
            logger.info(f"Pure number input, returning intent 0 | text={repr(text)}")
            return {"code": 200, "message": "success", "data": {"intent_id": 0}}

        # 检查缓存
        cache_key = normalize_text(text)
        if cache_key in cache:
            logger.info(f"Cache hit | text={repr(text)} | cached_data={cache[cache_key]}")
            return {"code": 200, "message": "success", "data": cache[cache_key].copy()}

        try:
            # ======================================================
            # 优先级1: 强规则 21 / 20 (根据位置/名字打开视频)
            # ======================================================
            idx = extract_video_index(text)
            dt = parse_video_datetime(text)

            def _course_name(t: str) -> str:
                t = _DATE_TIME_RE.sub(" ", t)
                t = _VIDEO_INDEX_RE.sub(" ", t)
                t = re.sub(r"(小达小达|帮我|请|麻烦|打开|播放|查看|找一下|看一下|一下|的)", " ", t)
                t = re.sub(r"(视频|回放|录像)", " ", t)
                t = re.sub(r"\s+", " ", t).strip()
                return t

            # Intent 21: 根据名字和时间打开视频
            if dt and ("视频" in text or "回放" in text or "录像" in text) and (("打开" in text) or ("播放" in text)):
                name = _course_name(text)
                if name and name not in ("其他", "这个", "那个", "视频", "回放", "录像"):
                    data = {
                        "intent_id": 21,
                        "index_pb": int(idx) if idx is not None else 0,
                        "time_pb": dt,
                        "name_pb": name,
                    }
                    logger.info(f"Rule21 matched | text={repr(text)} | data={data}")
                    # 缓存结果
                    if len(cache) < cache_max_size:
                        cache[cache_key] = data.copy()
                    return {"code": 200, "message": "success", "data": data}

            # Intent 20: 根据位置打开回放视频（排除删除操作）
            if idx is not None and ("第" in text and "个" in text) and (("打开" in text) or ("播放" in text) or ("视频" in text)) and "删" not in text:
                data = {"intent_id": 20, "index_pb": int(idx)}
                logger.info(f"Rule20 matched | text={repr(text)} | data={data}")
                # 缓存结果
                if len(cache) < cache_max_size:
                    cache[cache_key] = data.copy()
                return {"code": 200, "message": "success", "data": data}

            # ======================================================
            # 优先级2: 高频明确指令 - 关键词硬规则匹配
            # ======================================================
            hard_data = match_hard_rule(text)
            if hard_data is not None:
                logger.info(f"Hard rule matched | text={repr(text)} | data={hard_data}")
                # 缓存结果
                if len(cache) < cache_max_size:
                    cache[cache_key] = hard_data.copy()
                return {"code": 200, "message": "success", "data": hard_data}

            # ======================================================
            # 无法识别的指令 - 返回 intent_id=0
            # ======================================================
            logger.info(f"No rule matched | text={repr(text)} | returning intent_id=0")
            return {"code": 200, "message": "success", "data": {"intent_id": 0}}

        except Exception as e:
            logger.error(f"[SERVICE_ERROR] {type(e).__name__}: {str(e)}")
            logger.error(traceback.format_exc())
            return {"code": 500, "message": "server_error", "data": {}}

    return service



# =========================
# Flask app
# =========================
app = Flask(__name__)
app.config["JSON_AS_ASCII"] = False

# 启用CORS支持，允许所有来源访问
CORS(app)

INTENT_SERVICE = build_intent_service()


@app.get("/health")
def health():
    logger.info("GET /health")
    return jsonify({"status": "True"})


@app.post("/intent")
def intent_api():
    t0 = time.perf_counter()
    logger.info("POST /intent called")

    try:
        payload = request.get_json(force=True, silent=False)
        logger.info(f"Request payload: {payload}")
    except Exception as e:
        logger.warning(f"JSON parse error: {str(e)}")
        body = {"code": 400, "message": "param_error", "data": {}}
        logger.info("-" * 80)
        return Response(json.dumps(body, ensure_ascii=False), mimetype="application/json"), 400

    resp = INTENT_SERVICE(payload)
    resp["latency_ms"] = round((time.perf_counter() - t0) * 1000, 2)

    http_status = 200 if resp.get("code") == 200 else (400 if resp.get("code") == 400 else 500)

    logger.info(f"Response: {resp}")
    logger.info(f"HTTP {http_status} | latency_ms={resp['latency_ms']}")
    logger.info("-" * 80)
    logger.info("-" * 80)
    logger.info("-" * 80)

    return Response(json.dumps(resp, ensure_ascii=False), mimetype="application/json"), http_status


if __name__ == "__main__":
    logger.info("Starting Flask app on 0.0.0.0:8024")
    app.run(host="0.0.0.0", port=8024, debug=False)
