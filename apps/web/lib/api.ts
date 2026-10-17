import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  deviceStartSchema,
  devicePollSchema,
  deviceApproveSchema,
  sponsorInquirySchema,
} from "@freecoda/contracts";
import { publicConfig, appUrl } from "./config";
import { json, handle, ApiError, jsonBody, sameOrigin } from "./http";
import { sessionUser } from "./auth";
import { getPool, transaction } from "./db";
import {
  identity,
  rateLimit,
  clientKey,
  startDevice,
  approveDevice,
  pollDevice,
} from "./security";
import { usageSnapshot } from "./usage";
import { selectAd, recordAd } from "./ads";
import { inference } from "./inference";
export async function route(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    const path = url.pathname.replace("/api/v1/", "");
    const method = req.method;
    if (path === "health" && method === "GET")
      return json({ status: "ok", ...publicConfig() });
    if (path === "ads" && method === "GET") {
      const placement = url.searchParams.get("placement");
      if (placement !== "web" && placement !== "terminal")
        throw new ApiError(400, "Unknown placement.");
      if (publicConfig().database)
        await rateLimit(`ad-selection:${clientKey(req)}`, 60, 60);
      return json(await selectAd(placement));
    }
    if (path === "ads/impression" && method === "POST") {
      const { token } = await jsonBody(
        req,
        z.object({ token: z.string().max(800) }).strict(),
        1200,
      );
      await recordAd(token, "impression");
      return json({ ok: true });
    }
    if (path === "ads/click" && method === "GET") {
      const token = url.searchParams.get("token");
      if (!token) throw new ApiError(400, "Sponsor token required.");
      const target = await recordAd(token, "click");
      const dest = new URL(target);
      if (dest.protocol !== "https:")
        throw new ApiError(400, "Invalid sponsor URL.");
      return new Response(null, {
        status: 302,
        headers: {
          Location: dest.toString(),
          "Referrer-Policy": "no-referrer",
          "Cache-Control": "no-store",
        },
      });
    }
    if (path === "sponsor/inquiry" && method === "POST") {
      sameOrigin(req);
      if (!publicConfig().database)
        throw new ApiError(
          503,
          "Sponsor inquiries open when the beta database is connected. Please check back shortly.",
        );
      await rateLimit(`inquiry:${clientKey(req)}`, 5, 3600);
      const body = await jsonBody(req, sponsorInquirySchema, 4000);
      if (body.companyUrl) return json({ ok: true });
      await getPool().query(
        "INSERT INTO sponsor_inquiries(id,business,email,website,message) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), body.business, body.email, body.website, body.message],
      );
      return json({ ok: true }, 201);
    }
    if (path === "workspace" && method === "GET") {
      const c = publicConfig();
      const user = await sessionUser(req);
      return json({
        configured: c.auth,
        services: [
          { label: "Account sign-in", ready: c.auth },
          { label: "Usage database", ready: c.database },
          { label: "Hosted AI", ready: c.gateway && c.hostedEnabled },
          { label: "Sponsor placements", ready: c.ads },
        ],
        ...(user
          ? { user: { name: user.name }, usage: await usageSnapshot(user.id) }
          : {}),
      });
    }
    if (path === "device/start" && method === "POST") {
      if (!publicConfig().auth)
        throw new ApiError(503, "Hosted sign-in is not configured yet.");
      await rateLimit(`device-start:${clientKey(req)}`, 10, 3600);
      const body = await jsonBody(req, deviceStartSchema, 500);
      const data = await startDevice(body.name);
      return json(
        {
          ...data,
          verificationUri: `${appUrl()}/device?code=${data.userCode}`,
        },
        201,
      );
    }
    if (path === "device/poll" && method === "POST") {
      const body = await jsonBody(req, devicePollSchema, 500);
      await rateLimit(`device-poll:${clientKey(req)}`, 120, 60);
      return json(await pollDevice(body.deviceCode));
    }
    if (path === "device/approve" && method === "POST") {
      sameOrigin(req);
      const user = await identity(req);
      if (user.device)
        throw new ApiError(403, "Approve from your browser workspace.");
      await rateLimit(`device-approve:${user.id}`, 10, 600);
      const body = await jsonBody(req, deviceApproveSchema, 500);
      await approveDevice(body.code, user.id);
      return json({ ok: true });
    }
    if (path === "usage" && method === "GET") {
      const user = await identity(req);
      return json(await usageSnapshot(user.id));
    }
    if (path === "models" && method === "GET") {
      const user = await identity(req);
      const { rows } = await getPool().query(
        "SELECT config FROM model_catalog WHERE config->>'approved'='true' ORDER BY id",
      );
      return json({
        models: rows.map((r) => r.config),
        hostedEnabled: publicConfig().hostedEnabled,
      });
    }
    if (path === "inference" && method === "POST") return inference(req);
    if (path === "devices/logout" && method === "POST") {
      const user = await identity(req);
      if (!user.device) throw new ApiError(400, "CLI token required.");
      await getPool().query(
        "UPDATE devices SET revoked_at=now() WHERE id=$1 AND user_id=$2",
        [user.device_id, user.id],
      );
      return json({ ok: true });
    }
    if (path === "devices/revoke" && method === "POST") {
      sameOrigin(req);
      const user = await identity(req);
      if (user.device)
        throw new ApiError(403, "Revoke devices from your browser workspace.");
      const body = await jsonBody(
        req,
        z.object({ id: z.uuid() }).strict(),
        500,
      );
      await getPool().query(
        "UPDATE devices SET revoked_at=now() WHERE id=$1 AND user_id=$2",
        [body.id, user.id],
      );
      return json({ ok: true });
    }
    if (path === "account/delete" && method === "POST") {
      sameOrigin(req);
      const user = await identity(req);
      if (user.device)
        throw new ApiError(
          403,
          "Delete your account from the browser workspace.",
        );
      await transaction(async (db) => {
        await db.query("DELETE FROM invitations WHERE lower(email)=lower($1)", [
          user.email,
        ]);
        await db.query('DELETE FROM "user" WHERE id=$1', [user.id]);
      });
      return json({ ok: true });
    }
    throw new ApiError(404, "Endpoint not found.");
  });
}
