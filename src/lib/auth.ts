import crypto from "crypto";
import type { NextRequest, NextResponse } from "next/server";

const adminCookieName = "weatherstation_admin";
const sessionMaxAgeSeconds = 7 * 24 * 60 * 60;

function stationApiKey() {
  return process.env.WEATHER_STATION_API_KEY ?? "";
}

function adminPassword() {
  return process.env.WEATHER_STATION_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? "";
}

function sessionSecret() {
  return process.env.ADMIN_SESSION_SECRET ?? (stationApiKey() || adminPassword());
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function sign(value: string) {
  return crypto.createHmac("sha256", sessionSecret()).update(value).digest("hex");
}

export function adminPasswordConfigured() {
  return adminPassword().length > 0 && sessionSecret().length > 0;
}

export function verifyAdminPassword(password: string) {
  return adminPasswordConfigured() && safeEqual(password, adminPassword());
}

export function createAdminSession() {
  const payload = `v1.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

export function isAdminRequest(request: NextRequest) {
  const value = request.cookies.get(adminCookieName)?.value ?? "";
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;

  const payload = `${parts[0]}.${parts[1]}`;
  const issuedAt = Number(parts[1]);
  if (!Number.isFinite(issuedAt)) return false;
  if (Date.now() - issuedAt > sessionMaxAgeSeconds * 1000) return false;
  return safeEqual(parts[2], sign(payload));
}

export function setAdminSessionCookie(response: NextResponse, value: string) {
  response.cookies.set(adminCookieName, value, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionMaxAgeSeconds
  });
}

export function clearAdminSessionCookie(response: NextResponse) {
  response.cookies.set(adminCookieName, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

export function isDeviceAuthorized(request: NextRequest) {
  const expected = stationApiKey();
  if (!expected) return false;

  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const apiKey = request.headers.get("x-api-key") ?? "";
  return safeEqual(bearer, expected) || safeEqual(apiKey, expected);
}
