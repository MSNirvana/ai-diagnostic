import pytest
from app.llm.base import LLMClient


def test_llmclient_is_abstract():
    with pytest.raises(TypeError):
        LLMClient()


def test_subclass_must_implement_complete():
    class Incomplete(LLMClient):
        pass
    with pytest.raises(TypeError):
        Incomplete()
