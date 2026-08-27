"""09-SDD P2-07：PII 分类与脱敏。"""
from app.pii import mask_pii, mask_structure


def test_mask_phone():
    assert mask_pii("联系电话 13812345678 请联系") == "联系电话 138****5678 请联系"
    assert "13812345678" not in mask_pii("13812345678")


def test_mask_email():
    masked = mask_pii("邮箱 zhang.san@example.com 收到")
    assert "zhang.san@" not in masked
    assert "@example.com" in masked


def test_mask_idcard_and_bankcard():
    assert "110101199001011234" not in mask_pii("身份证 110101199001011234")
    assert "6222020200112233445" not in mask_pii("卡号 6222020200112233445")


def test_mask_structure_recursive():
    obj = {"user": {"phone": "13812345678", "name": "张三"},
           "items": [{"email": "a@b.com"}], "count": 5}
    masked = mask_structure(obj)
    assert "13812345678" not in str(masked)
    assert "a@b.com" not in str(masked)
    assert masked["user"]["name"] == "张三"  # 非 PII 不变
    assert masked["count"] == 5


def test_mask_pii_passthrough_non_str():
    assert mask_pii(None) is None
    assert mask_pii(123) == 123
