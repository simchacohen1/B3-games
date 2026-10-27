# Administrator sign-in security

The B3 Access Controls page uses Firebase Authentication with the authorized Google account. Firebase Realtime Database rules and authenticated Cloud Functions enforce access to protected operations. The former browser-only password prompt was not an authorization boundary. This change removes it and opens the existing Google sign-in flow directly.

## Handling the retired shared password

The old prompt's SHA-256 hash was committed in public HTML. Treat its underlying shared password as compromised. This source change removes the gate, but production remains unchanged until a separately approved release. The hash itself does not authenticate a Firebase or Google account. No Firebase Auth password reset or production secret change is required solely because this gate is removed.

Retire the old gate password; do not reuse it. If it was reused for any Google, Firebase, email, hosting, or other account, change it through that service's official account recovery or password settings. Use a unique password for each account and enable multi-factor authentication on the owner Google account. Do not create a replacement shared administrator password or put credentials in website code, repository files, or browser storage.

The published Git history may retain the old hash even after the current website files are cleaned up. Credential retirement is the safe mitigation; rewriting repository history would disrupt existing branches and is not part of this change.

## Safe administrator migration checks

1. Keep the owner's existing verified Google sign-in and confirm the owner remains authorized by the current Firebase rules.
2. Confirm a non-authorized Google account can sign in but cannot see or change administrator controls or protected data.
3. Confirm an authorized teacher still receives only their assigned class access.
4. Confirm administrator and teacher actions are enforced by Realtime Database rules or Functions that verify Firebase ID tokens, not by browser visibility checks.
5. Do not change production credentials, access records, or Firebase rules as part of the website-only code change. Handle any production remediation separately with explicit approval.
