import { useLanguage } from "@/lib/contexts/language";

export type StrengthLevel = 0 | 1 | 2 | 3;

export function scorePassword(password: string): StrengthLevel {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[0-9]/.test(password) && /[a-zA-Z]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password) || /[A-Z]/.test(password)) score++;
  if (score >= 4) return 3;
  if (score >= 2) return 2;
  return 1;
}

const BAR_COLORS = ["bg-afya-border", "bg-afya-red", "bg-afya-gold", "bg-afya-green"];

export function PasswordStrengthMeter({ password }: { password: string }) {
  const { t } = useLanguage();
  const level = scorePassword(password);
  if (!password) return null;

  const label = level === 3 ? t("password_strength_strong") : level === 2 ? t("password_strength_fair") : t("password_strength_weak");
  const labelColor = level === 3 ? "text-afya-green" : level === 2 ? "text-[#8a6d00]" : "text-afya-red";

  return (
    <div className="mt-1.5" aria-live="polite">
      <div className="flex gap-1.5">
        {[1, 2, 3].map((bar) => (
          <div
            key={bar}
            className={`h-1 flex-1 rounded-full transition-colors ${bar <= level ? BAR_COLORS[level] : "bg-afya-border"}`}
          />
        ))}
      </div>
      <p className={`text-xs mt-1 font-medium ${labelColor}`}>{label}</p>
    </div>
  );
}
