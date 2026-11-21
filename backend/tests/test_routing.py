from app.orchestration.routing import decide_outcome, route_after_approval, route_after_request


def test_route_after_request():
    assert route_after_request({"parsed_request": {"status": "valid"}}) == "vendor_agent"
    assert route_after_request({"parsed_request": {"status": "invalid"}}) == "finalize"
    assert route_after_request({}) == "finalize"


def test_route_after_approval():
    assert route_after_approval({"approval_assessment": {"approval_required": True}}) == "human_review"
    assert route_after_approval({"approval_assessment": {"approval_required": False}}) == "finalize"


def test_decide_outcome():
    valid = {"parsed_request": {"status": "valid"}}
    assert decide_outcome({"parsed_request": {"status": "invalid"}}) == "failed_validation"
    assert decide_outcome({**valid, "approval_assessment": {"recommendation": "approve"}}) == "approved"
    assert decide_outcome({**valid, "approval_assessment": {"recommendation": "reject"}}) == "rejected"
    human_no = {**valid, "approval_assessment": {"recommendation": "approve"}, "human_decision": {"decision": "reject"}}
    assert decide_outcome(human_no) == "rejected"
    human_yes = {**valid, "approval_assessment": {"recommendation": "approve"}, "human_decision": {"decision": "approve"}}
    assert decide_outcome(human_yes) == "approved"
