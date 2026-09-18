// ─── AFYA MAZINGIRA database schema ────────────────────────────────────────────────
import {
  pgTable, serial, integer, text, real, boolean,
  timestamp, jsonb, date, uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  password_hash: text("password_hash").notNull(),
  password_salt: text("password_salt").notNull(),
  language: text("language").notNull().default("en"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── User preferences ─────────────────────────────────────────────────────────
export const userPreferences = pgTable("user_preferences", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  language: text("language").notNull().default("en"),
  units: text("units").notNull().default("C"),
  preferred_activities: jsonb("preferred_activities").$type<string[]>().notNull().default([]),
  notification_prefs: jsonb("notification_prefs").$type<Record<string, boolean>>().notNull().default({}),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Activity plans ───────────────────────────────────────────────────────────
export const activityPlans = pgTable("activity_plans", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  activity_type: text("activity_type").notNull(),
  activity_label: text("activity_label"),
  duration_minutes: integer("duration_minutes").notNull(),
  available_start: text("available_start").notNull(), // ISO
  available_end: text("available_end").notNull(),     // ISO
  preferred_start: text("preferred_start"),
  last_result: jsonb("last_result").$type<unknown>(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Saved activity profiles ──────────────────────────────────────────────────
export const savedActivityProfiles = pgTable("saved_activity_profiles", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  activity_type: text("activity_type").notNull(),
  duration_minutes: integer("duration_minutes").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Notification rules ───────────────────────────────────────────────────────
export const notificationRules = pgTable("notification_rules", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  rule_type: text("rule_type").notNull(),
  activity_type: text("activity_type"),
  enabled: boolean("enabled").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Push subscriptions ───────────────────────────────────────────────────────
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Conduit observations (system-generated, read-only) ───────────────────────
export const conduitObservations = pgTable("conduit_observations", {
  id: serial("id").primaryKey(),
  ts: timestamp("ts", { withTimezone: true }).notNull(),
  rg1: real("rg1"),
  rg2: real("rg2"),
  rg1tt: real("rg1tt"),
  rg2tt: real("rg2tt"),
  rg1tp: real("rg1tp"),
  rg2tp: real("rg2tp"),
  temp_bmx: real("temp_bmx"),
  press_bmx: real("press_bmx"),
  temp_mcp: real("temp_mcp"),
  temp_sht: real("temp_sht"),
  humidity_sht: real("humidity_sht"),
  si1145_vis: real("si1145_vis"),
  si1145_ir: real("si1145_ir"),
  si1145_uv: real("si1145_uv"),
  wind_spd: real("wind_spd"),
  wind_dir: real("wind_dir"),
  wind_gust: real("wind_gust"),
  heat_idx: real("heat_idx"),
  wet_bulb_temp: real("wet_bulb_temp"),
  wet_bulb_globe_temp: real("wet_bulb_globe_temp"),
  quality_status: text("quality_status").notNull().default("GOOD"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("obs_ts_idx").on(t.ts),
]);

// ─── Environmental states (system-generated) ──────────────────────────────────
export const environmentalStates = pgTable("environmental_states", {
  id: serial("id").primaryKey(),
  ts: timestamp("ts", { withTimezone: true }).notNull(),
  state_id: integer("state_id").notNull(),
  state_name: text("state_name").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("env_states_ts_idx").on(t.ts),
]);

// ─── Forecasts (system-generated) ────────────────────────────────────────────
export const forecasts = pgTable("forecasts", {
  id: serial("id").primaryKey(),
  issued_at: timestamp("issued_at", { withTimezone: true }).notNull(),
  target_time: timestamp("target_time", { withTimezone: true }).notNull(),
  horizon: text("horizon").notNull(), // "1h" | "3h" | "6h"
  target_name: text("target_name").notNull().default("wet_bulb_globe_temp"),
  prediction: real("prediction").notNull(),
  lower_bound: real("lower_bound").notNull(),
  upper_bound: real("upper_bound").notNull(),
  model_name: text("model_name").notNull(),
  model_version: text("model_version").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("forecasts_issued_idx").on(t.issued_at),
]);

// ─── Activity recommendations (system audit log) ──────────────────────────────
export const activityRecommendations = pgTable("activity_recommendations", {
  id: serial("id").primaryKey(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  user_id: integer("user_id").references(() => users.id),
  activity_type: text("activity_type").notNull(),
  duration_minutes: integer("duration_minutes").notNull(),
  available_start: text("available_start").notNull(),
  available_end: text("available_end").notNull(),
  recommended_start: text("recommended_start"),
  recommended_end: text("recommended_end"),
  risk_level: text("risk_level"),
  explanation_json: jsonb("explanation_json").$type<unknown>(),
});

// ─── Data quality events ──────────────────────────────────────────────────────
export const dataQualityEvents = pgTable("data_quality_events", {
  id: serial("id").primaryKey(),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull(),
  source: text("source").notNull().default("conduit"),
  flag_code: text("flag_code"),
  message: text("message"),
});

// ─── Model metadata ───────────────────────────────────────────────────────────
export const modelMetadata = pgTable("model_metadata", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  version: text("version").notNull(),
  algorithm: text("algorithm").notNull(),
  target: text("target").notNull(),
  horizon_minutes: integer("horizon_minutes").notNull(),
  mae: real("mae"),
  training_start: date("training_start"),
  training_end: date("training_end"),
  artifact_path: text("artifact_path"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── ERA5 context (demo-seeded) ───────────────────────────────────────────────
export const era5Context = pgTable("era5_context", {
  id: serial("id").primaryKey(),
  valid_time: timestamp("valid_time", { withTimezone: true }).notNull(),
  temp_c: real("temp_c"),
  dewpoint_c: real("dewpoint_c"),
  relative_humidity: real("relative_humidity"),
  pressure_hpa: real("pressure_hpa"),
  wind_speed_ms: real("wind_speed_ms"),
  wind_dir_deg: real("wind_dir_deg"),
  solar_wm2: real("solar_wm2"),
  precip_hourly_mm: real("precip_hourly_mm"),
  soil_moisture: real("soil_moisture"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── CHIRPS context (demo-seeded) ─────────────────────────────────────────────
export const chirpsContext = pgTable("chirps_context", {
  id: serial("id").primaryKey(),
  valid_date: date("valid_date").notNull(),
  rain_mm: real("rain_mm"),
  rain_7d_mm: real("rain_7d_mm"),
  rain_30d_mm: real("rain_30d_mm"),
  percentile: real("percentile"),
  dry_spell_days: integer("dry_spell_days"),
  wet_spell_days: integer("wet_spell_days"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Type exports ─────────────────────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ActivityPlan = typeof activityPlans.$inferSelect;
export type NewActivityPlan = typeof activityPlans.$inferInsert;
export type NotificationRule = typeof notificationRules.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type EnvironmentalState = typeof environmentalStates.$inferSelect;
export type Forecast = typeof forecasts.$inferSelect;
export type ConduitObservation = typeof conduitObservations.$inferSelect;
