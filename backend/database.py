from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime

SQLALCHEMY_DATABASE_URL = "sqlite:///./fsf_data.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# ── ACS Need Score Records ─────────────────────────────────────────────────────
class ACSRecord(Base):
    __tablename__ = "acs_records"
    id                      = Column(Integer, primary_key=True, index=True)
    tract_id                = Column(String, index=True)
    neighborhood            = Column(String)
    county                  = Column(String)
    latitude                = Column(Float)
    longitude               = Column(Float)
    need_score              = Column(Float)
    food_access_index       = Column(Float)
    population              = Column(Integer)
    median_income           = Column(Float)
    pct_below_poverty       = Column(Float)
    pct_snap_enrollment     = Column(Float)
    pct_no_vehicle          = Column(Float)
    pct_low_income          = Column(Float)
    food_desert             = Column(Integer)
    supermarket_dist_mi     = Column(Float)
    pct_children_under18    = Column(Float)
    pct_seniors_65plus      = Column(Float)
    unemployment_rate       = Column(Float)
    housing_cost_burden_pct = Column(Float)
    acs_year                = Column(Integer)
    upload_batch_id         = Column(Integer)


# ── ACS Upload Batches ─────────────────────────────────────────────────────────
class UploadBatch(Base):
    __tablename__ = "upload_batches"
    id          = Column(Integer, primary_key=True, index=True)
    filename    = Column(String)
    uploaded_by = Column(String)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    row_count   = Column(Integer)
    status      = Column(String)   # "active" | "archived"
    acs_year    = Column(Integer)


# ── FSF Distribution Records (Accomplishment Score) ────────────────────────────
class FSFDistribution(Base):
    __tablename__ = "fsf_distributions"
    id                  = Column(Integer, primary_key=True, index=True)
    zip_code            = Column(String, index=True)
    county              = Column(String)
    households_served   = Column(Integer)
    individuals_served  = Column(Integer)
    meals_served        = Column(Float)
    month               = Column(String)
    dist_year           = Column(Integer)
    impact_score= Column(Float)
    upload_batch_id     = Column(Integer)


# ── FSF Distribution Upload Batches ───────────────────────────────────────────
class FSFUploadBatch(Base):
    __tablename__ = "fsf_upload_batches"
    id          = Column(Integer, primary_key=True, index=True)
    filename    = Column(String)
    uploaded_by = Column(String)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    row_count   = Column(Integer)
    dist_year   = Column(Integer)
    status      = Column(String)   # "active" | "archived"
