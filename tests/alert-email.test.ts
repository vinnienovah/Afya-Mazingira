import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, renderAlertEmailHtml } from "../src/lib/afya/alert-email";

const LINK = "https://afya-mazingira.vercel.app/notifications";

test("a display name cannot inject HTML into an alert email", () => {
  const name = `<a href="https://evil.example/login">Your account is locked</a><img src=x onerror=alert(1)>`;
  const html = renderAlertEmailHtml(name, ["Peak WBGT 27.4 °C at 14:00."], LINK, "View Notifications", "en");

  assert.ok(!html.includes('<a href="https://evil.example'));
  assert.ok(!html.includes("<img"));
  // The markup survives as the text it is, which is the point.
  assert.ok(html.includes("Hi &#60;a href=&#34;https://evil.example/login&#34;&#62;Your account is locked&#60;/a&#62;"));
  assert.ok(html.includes("&#60;img src=x onerror=alert(1)&#62;"));
  // Only the real call to action is a link.
  assert.equal(html.match(/<a /g)?.length, 1);
});

test("a name with an ampersand reads as itself", () => {
  const html = renderAlertEmailHtml("Wanjiru & Otieno", [], LINK, "View", "sw");
  assert.match(html, /Habari Wanjiru &#38; Otieno,/);
});

test("the call-to-action link is escaped into its attribute", () => {
  const html = renderAlertEmailHtml("Achieng", [], `${LINK}?from="onmouseover="alert(1)`, "View", "en");
  assert.ok(!html.includes('"onmouseover='));
  assert.match(html, /href="https:\/\/afya-mazingira\.vercel\.app\/notifications\?from=&#34;onmouseover=&#34;alert\(1\)"/);
});

test("escapeHtml covers text and attribute contexts", () => {
  assert.equal(escapeHtml(`<b>"Tom" & 'Jerry'</b>`), "&#60;b&#62;&#34;Tom&#34; &#38; &#39;Jerry&#39;&#60;/b&#62;");
  assert.equal(escapeHtml("Achieng Otieno"), "Achieng Otieno");
});

test("alert body paragraphs are passed through as the HTML the engine wrote", () => {
  // The rule engine builds these lines itself; they carry its own markup.
  const html = renderAlertEmailHtml("Achieng", ["Peak <strong>27.4 °C</strong>"], LINK, "View", "en");
  assert.ok(html.includes("Peak <strong>27.4 °C</strong>"));
});
