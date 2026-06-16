import { NextResponse, type NextRequest } from 'next/server';
import { startAdminSession } from '../../../../src/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Accepts `application/x-www-form-urlencoded` from the login form OR
 * `application/json` with `{password}`. The submitted password is checked
 * against ADMIN_PASSWORD via timing-safe compare; on success the session
 * cookie is set and we return 204. Failure returns a generic 401 with no
 * detail so timing/error responses don't leak password length.
 *
 * The password never appears in the response body. The cookie is HttpOnly.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let password = '';
  const ct = req.headers.get('content-type') ?? '';
  try {
    if (ct.includes('application/json')) {
      const body = (await req.json()) as { password?: string };
      password = body.password ?? '';
    } else {
      const form = await req.formData();
      password = String(form.get('password') ?? '');
    }
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const result = await startAdminSession(password);
  if (!result.ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return new NextResponse(null, { status: 204 });
}
