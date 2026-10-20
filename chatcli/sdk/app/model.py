from __future__ import annotations

import json
import time
import urllib.request
from urllib.parse import quote

from sdk.agent_sdk import ModelRequest, ModelResponse

class MattermostModel:
    def __init__(self, state, config):
        self.state = state
        self.config = config

    def _headers(self) -> dict[str, str]:
        account = self.state.current_account
        return {
            "Accept": "*/*",
            "Content-Type": "text/plain;charset=UTF-8",
            "Origin": self.config.base_url,
            "User-Agent": "Mozilla/5.0",
            "X-CSRF-Token": account["CSRF_TOKEN"],
            "X-Requested-With": "XMLHttpRequest",
            "Cookie": f"MMAUTHTOKEN={account['AUTH_TOKEN']}; MMUSERID={account['USER_ID']}; MMCSRF={account['CSRF_TOKEN']}",
        }

    def _request(self, method: str, path: str, payload=None):
        url = f"{self.config.base_url}{path}"
        data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(url, data=data, headers=self._headers(), method=method)
        with urllib.request.urlopen(request, timeout=240) as response:
            return json.loads(response.read().decode("utf-8"))

    def complete(self, request: ModelRequest) -> ModelResponse:
        account = self.state.current_account
        key = self.state.current_model_key
        query = f"requestTime={int(time.time() * 1000)}&accessTeam={quote(account['TEAM_ID'])}"
        if key == "sendMessageToGemini":
            query += f"&chatModel={quote(self.state.current_model_name)}&enableWebSearch={'true' if 'Flash Lite' in self.state.current_model_name else 'false'}"
        result = self._request(
            "POST",
            f"/plugins/aslead-chatgpt/{key}?{query}",
            self._wire_messages(request),
        )
        if not result or not result.get("respMessage"):
            raise RuntimeError(f"模型响应无效: {result}")
        return ModelResponse(text=result["respMessage"], raw=result)

    @staticmethod
    def _wire_messages(request: ModelRequest) -> list[dict]:
        sections = [request.system.strip(), request.protocol.strip()]
        if request.tools:
            sections.append(
                "## 可用工具\n"
                + json.dumps(
                    request.tools, ensure_ascii=False, separators=(",", ":")
                )
            )
        system_content = "\n\n".join(section for section in sections if section)
        if not system_content:
            return list(request.messages)
        return [{"role": "system", "content": system_content}] + list(request.messages)

    def get_me(self):
        return self._request("GET", "/api/v4/users/me")

    def get_usage(self):
        return self._request("GET", "/plugins/aslead-chatgpt/checkUserShow?isKeyDown=false")
