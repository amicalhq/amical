import { z } from 'zod';

/**
 * `POST /apps/v1/me/sequenzy-identity-token`: a Sequenzy identity token for the caller's account
 * email. The request has no body. 400 when the credential has no email, 403 when Sequenzy is not
 * configured or refuses the email, 502 for any other Sequenzy failure.
 */
export const SequenzyIdentityTokenResponseSchema = z
  .object({ identityToken: z.string().min(1) })
  .strip();
export type SequenzyIdentityTokenResponse = z.infer<typeof SequenzyIdentityTokenResponseSchema>;
