# Email verification setup

The application verifies email ownership through Supabase Auth and sends the
authentication email through Resend SMTP. The application database does not
store a separate verification flag; Supabase Auth remains the source of truth.

## Supabase dashboard

1. Open **Authentication > Providers > Email** and enable **Confirm email**.
2. Open **Authentication > URL Configuration**.
   - Site URL: `https://share-ed.online`
   - Redirect URL: `https://share-ed.online/verify-email`
   - Add the local frontend URL for development only.
3. Connect Resend under **Project Settings > Integrations**, or enter the Resend
   SMTP credentials under **Authentication > SMTP Settings**.
4. Use a verified sender such as `SHARE-ED <no-reply@share-ed.online>`.

## Confirm signup email template

The frontend expects the six-digit `Token` value. Configure the **Confirm
signup** template to include `{{ .Token }}` instead of a direct confirmation
link. A minimal production template is:

```html
<h2>ยืนยันอีเมลสำหรับ SHARE-ED</h2>
<p>รหัสยืนยันของคุณคือ</p>
<p style="font-size:32px;font-weight:700;letter-spacing:8px">{{ .Token }}</p>
<p>หากคุณไม่ได้สมัคร SHARE-ED สามารถละเว้นอีเมลนี้ได้</p>
```

Disable click/open tracking for authentication emails. Never expose the
Supabase service-role key or the Resend API key in frontend environment files.

## Application environment

Set the following backend variable:

```env
EMAIL_VERIFICATION_REDIRECT_URL=https://share-ed.online/verify-email
```

After changing the dashboard settings, test signup, invalid OTP, expired OTP,
resend throttling, successful confirmation, and login from a fresh browser.
