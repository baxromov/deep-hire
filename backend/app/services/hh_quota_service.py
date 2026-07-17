from app.services.cleverstaff_service import _call_mcp


async def get_quota_hh() -> dict:
    """Current HH.ru MCP usage snapshot (resume-view quota, daily reset time, per-account
    breakdown) via the quota_hh tool. The 500/day view budget is shared company-wide —
    every user of this MCP server draws from the same counter."""
    return await _call_mcp("quota_hh", {})
