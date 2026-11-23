from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import patch


def contract(source, name, owner):
    host = ModuleType("genlayer")
    message = SimpleNamespace(sender_address=owner)
    responses = []

    def interpret(prompt, *, response_format):
        assert response_format == "json" and "INSTRUCTIONS:" in prompt
        return responses.pop(0)

    def exposed(fn):
        return fn

    class Return:
        def __init__(self, value):
            self.calldata = value

    def run(leader, validate):
        result = leader()
        if not validate(Return(result)):
            raise ValueError("VALIDATORS_DISAGREE")
        return result

    host.u32, host.Address, host.TreeMap, host.allow_storage = int, str, dict, exposed
    host.gl = SimpleNamespace(
        Contract=object, message=message,
        public=SimpleNamespace(write=exposed, view=exposed),
        vm=SimpleNamespace(Return=Return, UserError=ValueError, unpack_result=exposed, run_nondet_unsafe=run),
        nondet=SimpleNamespace(exec_prompt=interpret),
    )
    scope = {}
    with patch.dict(sys.modules, {"genlayer":host}):
        exec(Path(source).read_text(),scope)
    return scope[name](), message, responses, scope
