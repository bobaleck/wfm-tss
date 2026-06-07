from fastapi import APIRouter
from app.api.v1 import auth, users, employees, teams, skills, analytics, schedules, integrations

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(employees.router, prefix="/employees", tags=["employees"])
api_router.include_router(teams.router, prefix="/teams", tags=["teams"])
api_router.include_router(skills.router, prefix="/skills", tags=["skills"])
api_router.include_router(analytics.router, prefix="/analytics", tags=["analytics"])
api_router.include_router(schedules.router, prefix="/schedules", tags=["schedules"])
api_router.include_router(integrations.router, prefix="/integrations", tags=["integrations"])
