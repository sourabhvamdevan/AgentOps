import pytest

from app.tools.request_parser import parse_budget, parse_request

DEPTS = ["Engineering", "Finance", "HR", "Marketing"]
PRODUCTS = ["keyboard", "laptop", "monitor"]


@pytest.mark.parametrize(
    "text,expected",
    [
        ("max budget of ₹8,00,000.", 800_000),
        ("budget Rs 800000", 800_000),
        ("budget Rs. 8,00,000", 800_000),
        ("INR 8 lakh", 800_000),
        ("up to 8L", 800_000),
        ("within 8 lakh", 800_000),
        ("₹1.5 crore cap", 15_000_000),
        ("budget ₹20,00,000", 2_000_000),
        ("₹50,000", 50_000),
        ("budget of 75000", 75_000),
        ("2.5 lakhs", 250_000),
        ("no money mentioned", None),
    ],
)
def test_parse_budget(text, expected):
    assert parse_budget(text) == expected


def test_sample_request():
    r = parse_request(
        "Purchase 10 laptops for the engineering department with a maximum budget of ₹8,00,000.", DEPTS, PRODUCTS
    )
    assert r.status == "valid"
    assert (r.department, r.product, r.quantity, r.maximum_budget) == ("Engineering", "laptop", 10, 800_000)
    assert r.missing_fields == []


def test_adjective_between_quantity_and_product():
    r = parse_request("Need 3 wireless keyboards for HR, budget Rs 10000", DEPTS, PRODUCTS)
    assert (r.department, r.product, r.quantity, r.maximum_budget) == ("HR", "keyboard", 3, 10_000)


def test_missing_everything():
    r = parse_request("buy some stuff", DEPTS, PRODUCTS)
    assert r.status == "invalid"
    assert set(r.missing_fields) == {"department", "product", "quantity", "maximum_budget"}


def test_unknown_department():
    r = parse_request("Buy 2 monitors for the legal department, budget ₹50,000", DEPTS, PRODUCTS)
    assert r.status == "invalid"
    assert r.department == "Legal"
    assert "unknown department" in r.reason


def test_quantity_out_of_range():
    r = parse_request("Buy 5000 keyboards for Finance with budget 2 crore", DEPTS, PRODUCTS)
    assert r.status == "invalid"
    assert "quantity" in r.reason


def test_unknown_product():
    r = parse_request("Buy 4 chairs for Finance with budget ₹40,000", DEPTS, PRODUCTS)
    assert r.status == "invalid"
    assert "product" in r.missing_fields


def test_budget_digits_not_taken_as_quantity():
    r = parse_request("Engineering needs laptops, budget ₹8,00,000", DEPTS, PRODUCTS)
    assert r.quantity is None
    assert r.missing_fields == ["quantity"]
