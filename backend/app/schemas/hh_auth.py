from pydantic import BaseModel


class HHLoginResponse(BaseModel):
    auth_url: str


class HHMeResponse(BaseModel):
    id: str
    name: str
    email: str = ""
    phone: str = ""
    is_employer: bool = False
    employer_id: str = ""
    employer_name: str = ""
