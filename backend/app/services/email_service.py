"""
OmniBot SaaS — Email Service
Sends transactional emails via SMTP (TLS).
Falls back to logging the reset link when SMTP is not configured (dev mode).
"""
import smtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.config import settings

logger = logging.getLogger(__name__)


def _build_reset_email(to_email: str, reset_url: str) -> MIMEMultipart:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "OmniBot — পাসওয়ার্ড রিসেট করুন"
    msg["From"]    = settings.SMTP_FROM
    msg["To"]      = to_email

    plain = f"""\
OmniBot পাসওয়ার্ড রিসেট

নিচের লিংকে ক্লিক করে আপনার পাসওয়ার্ড রিসেট করুন:
{reset_url}

এই লিংক ১ ঘণ্টা পর মেয়াদোত্তীর্ণ হবে।
যদি আপনি পাসওয়ার্ড রিসেটের অনুরোধ না করে থাকেন তাহলে এই ইমেইলটি উপেক্ষা করুন।

— OmniBot SaaS
"""

    html = f"""\
<!DOCTYPE html>
<html lang="bn">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F9F9F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9F9F9;padding:40px 20px;">
    <tr><td align="center">
      <table width="500" cellpadding="0" cellspacing="0"
             style="background:#FFFFFF;border-radius:8px;border:1px solid #E0E0E0;overflow:hidden;">

        <!-- Header -->
        <tr>
          <td style="background:#282A35;padding:28px 40px;">
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#04AA6D;border-radius:6px;width:36px;height:36px;text-align:center;vertical-align:middle;">
                  <span style="color:#fff;font-size:18px;font-weight:bold;">O</span>
                </td>
                <td style="padding-left:12px;color:#FFFFFF;font-size:18px;font-weight:bold;">OmniBot SaaS</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px;">
            <h1 style="margin:0 0 12px;font-size:22px;color:#282A35;">পাসওয়ার্ড রিসেট</h1>
            <p style="margin:0 0 24px;font-size:15px;color:#757575;line-height:1.6;">
              আপনার OmniBot account-এর পাসওয়ার্ড রিসেটের অনুরোধ পাওয়া গেছে।
              নিচের বাটনে ক্লিক করে নতুন পাসওয়ার্ড সেট করুন।
            </p>

            <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
              <tr>
                <td style="background:#04AA6D;border-radius:4px;">
                  <a href="{reset_url}"
                     style="display:inline-block;padding:12px 28px;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:15px;">
                    পাসওয়ার্ড রিসেট করুন
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 8px;font-size:13px;color:#9E9E9E;">বাটন কাজ না করলে নিচের লিংকটি কপি করুন:</p>
            <p style="margin:0 0 28px;font-size:12px;color:#04AA6D;word-break:break-all;">{reset_url}</p>

            <table width="100%" cellpadding="0" cellspacing="0"
                   style="background:#FFF8E1;border:1px solid #FFE082;border-radius:4px;padding:14px 16px;">
              <tr>
                <td style="font-size:13px;color:#F57F17;">
                  ⏱ এই লিংক <strong>১ ঘণ্টা</strong> পর মেয়াদোত্তীর্ণ হবে।
                  আপনি যদি এই অনুরোধ না করে থাকেন, তাহলে এই ইমেইলটি উপেক্ষা করুন।
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#F9F9F9;padding:20px 40px;border-top:1px solid #E0E0E0;">
            <p style="margin:0;font-size:12px;color:#9E9E9E;text-align:center;">
              &copy; 2026 OmniBot SaaS — Bangladesh's AI Sales Assistant
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
"""

    msg.attach(MIMEText(plain, "plain", "utf-8"))
    msg.attach(MIMEText(html,  "plain", "utf-8"))   # text/html via plain charset
    # Fix: use MIMEText with subtype html
    msg.get_payload().pop()                          # remove the last (broken html) part
    msg.attach(MIMEText(html, "html", "utf-8"))
    return msg


def send_password_reset_email(to_email: str, token: str) -> bool:
    """
    Send a password reset email.
    Returns True on success, False on failure.
    In dev mode (SMTP_HOST not set) logs the URL instead of sending.
    """
    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={token}"

    # ── Dev / no-SMTP fallback ────────────────────────────────────────────────
    if not settings.SMTP_HOST:
        logger.warning(
            "[DEV MODE] Password reset URL for %s:\n  %s",
            to_email, reset_url
        )
        return True   # caller treats this as success; API will return dev_token

    # ── Production SMTP ───────────────────────────────────────────────────────
    try:
        msg = _build_reset_email(to_email, reset_url)
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(settings.SMTP_USER, settings.SMTP_PASS)
            server.sendmail(settings.SMTP_FROM, [to_email], msg.as_string())
        logger.info("Password reset email sent to %s", to_email)
        return True
    except Exception as exc:                        # noqa: BLE001
        logger.error("Failed to send reset email to %s: %s", to_email, exc)
        return False
