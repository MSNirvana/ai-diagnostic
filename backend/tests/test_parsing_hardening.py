"""parse_json_object 加固测试：真实 LLM 输出的常见毛病应被修复或如实暴露。"""
import pytest

from app.skills.parsing import parse_json_object


def test_plain_json():
    assert parse_json_object('{"signal": "red"}') == {"signal": "red"}


def test_fenced_json():
    assert parse_json_object('```json\n{"signal": "green"}\n```') == {"signal": "green"}


def test_chinese_punctuation_inside_string_is_legal():
    # 中文逗号句号在字符串内部合法，不该被动
    out = parse_json_object('{"conclusion": "回本周期26个月，已超红线。"}')
    assert out["conclusion"] == "回本周期26个月，已超红线。"


def test_trailing_comma_object_repaired():
    assert parse_json_object('{"a": 1, "b": 2,}') == {"a": 1, "b": 2}


def test_trailing_comma_array_repaired():
    assert parse_json_object('{"items": [1, 2, 3,]}') == {"items": [1, 2, 3]}


def test_preamble_text_before_json():
    out = parse_json_object('好的，结果如下：\n{"signal": "yellow"}')
    assert out["signal"] == "yellow"


def test_unescaped_inner_quote_raises_honestly():
    # 字符串内未转义双引号无法安全自动修复，应如实抛错而非静默返回错误结构
    with pytest.raises(Exception):
        parse_json_object('{"c": "他说"你好"就走了"}')
