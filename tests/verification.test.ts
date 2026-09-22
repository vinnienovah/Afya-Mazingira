import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emailCap, escapeHtml, renderVerificationEmailHtml, MAX_EMAILS_PER_ADDRESS_PER_HOUR, MAX_EMAILS_PER_HOUR,
} from "../src/lib/auth/verification";

test("a sign-up name cannot inject HTML into the verification email", () => {
  const name = `<a href="https://evil.example/login">Your account is locked</a><img src=x onerror=alert(1)>`;
  const html = renderVerificationEmailHtml(name, "https://afya-mazingira.vercel.app/verify-email?token=abc", "en");
  assert.ok(!html.includes("<a href=\"https://evil.example"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("Hi &lt;a href=&quot;https://evil.example/login&quot;&gt;Your account is locked&lt;/a&gt;"));
  // Only the real link is a link.
  assert.equal(html.match(/<a /g)?.length, 1);
  assert.match(renderVerificationEmailHtml("Wanjiru & Otieno", "https://x/verify", "sw"), /Habari Wanjiru &amp; Otieno,/);
});

test("escapeHtml covers text and attribute contexts", () => {
  assert.equal(escapeHtml(`<b>"Tom" & 'Jerry'</b>`), "&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;");
  assert.equal(escapeHtml("Achieng Otieno"), "Achieng Otieno");
});

test("verification emails are capped per address and in total", () => {
  assert.equal(emailCap({ addressLastHour: 0, allLastHour: 0 }), "ok");
  assert.equal(emailCap({ addressLastHour: MAX_EMAILS_PER_ADDRESS_PER_HOUR - 1, allLastHour: 5 }), "ok");
  assert.equal(emailCap({ addressLastHour: MAX_EMAILS_PER_ADDRESS_PER_HOUR, allLastHour: 5 }), "address");
  assert.equal(emailCap({ addressLastHour: 0, allLastHour: MAX_EMAILS_PER_HOUR }), "global");
});
