-- Run only after replacing the email below with the exact email used by the site owner.
-- This grants admin role to that existing account; do not share this SQL publicly.
UPDATE public.profiles AS p
SET role = 'admin'
FROM auth.users AS u
WHERE p.id = u.id
  AND lower(u.email) = lower('amirfoolmm@gmail.com');

-- Verify which role the account has (replace the email again):
SELECT u.email, p.id, p.username, p.role
FROM auth.users AS u
JOIN public.profiles AS p ON p.id = u.id
WHERE lower(u.email) = lower('amirfoolmm@gmail.com');
