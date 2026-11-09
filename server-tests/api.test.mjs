import {assessPublishedTask} from './helpers/task-score.mjs';
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_CARD_STYLE } from "../shared/card-style.mjs";
import { DEMO_REQUESTS } from "../shared/demo-requests.mjs";

test("本地完整链路和权限边界", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "momoyu-test-"));
  const child = spawn(process.execPath, ["server/index.mjs"], {
    env: { ...process.env, DATA_DIR: dir, PORT: "0", DIFY_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    child.kill();
    await once(child, "exit").catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  });
  let output = "";
  let port;
  for await (const chunk of child.stdout) {
    output += chunk;
    const m = output.match(/"port":(\d+)/);
    if (m) {
      port = m[1];
      break;
    }
  }
  const base = `http://127.0.0.1:${port}`;
  async function call(path, method = "GET", data, cookie) {
    const r = await fetch(base + path, {
      method,
      headers: {
        ...(data ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  }
  const register = async (username) =>
    call("/api/auth/register", "POST", {
      username,
      password: "password123",
      displayName: username,
      department: "测试",
      skills: ["Excel"],
      availability: "周末",
      acceptingHelp: true,
      bio: "",
    });
  const seeded = await call('/api/requests');
  assert.equal(seeded.data.total, DEMO_REQUESTS.length);
  assert.equal(seeded.data.requests.filter(x=>x.source==='employee').length,6);
  assert.equal(seeded.data.requests.filter(x=>x.source==='official').length,4);
  assert.ok(seeded.data.requests.every(x=>x.isDemo && x.status==='open' && x.problem && x.desiredOutcome && x.deliverables.length));
  assert.deepEqual(seeded.data.requests.map(x=>x.title).sort(), DEMO_REQUESTS.map(x=>x.title).sort());
  const a = await register("alice"),
    b = await register("bob"),
    c = await register("charlie");
  assert.equal(a.status, 201);
  assert.equal(a.data.user.role, "employee");
  assert.ok(!JSON.stringify(a.data).includes("password"));
  assert.equal(
    (
      await call("/api/auth/register", "POST", {
        username: "evil",
        password: "password123",
        displayName: "E",
        department: "测试",
        role: "admin",
      })
    ).status,
    400,
  );
  assert.equal(
    (await call("/api/profile", "PUT", { role: "admin" }, a.cookie)).status,
    400,
  );
  assert.equal(
    (
      await call("/api/auth/login", "POST", {
        username: "alice",
        password: "wrongpassword",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call("/api/auth/login", "POST", {
        username: "alice",
        password: "password123",
      })
    ).status,
    200,
  );
  const draft = await call(
    "/api/clarify",
    "POST",
    { message: "问题：需要整理表格\n技能：Excel" },
    a.cookie,
  );
  assert.equal(draft.status, 200);
  const id = draft.data.request.id;
  assert.deepEqual(draft.data.request.cardStyle, DEFAULT_CARD_STYLE);
  const style = {theme:'rose',layout:'poster',radius:'square',emphasis:'bold'};
  assert.equal((await call(`/api/requests/${id}`, 'PATCH', {cardStyle:style}, b.cookie)).status, 404);
  assert.equal((await call(`/api/requests/${id}`, 'PATCH', {cardStyle:{...style,css:'color:red'}}, a.cookie)).status, 400);
  assert.equal((await call(`/api/requests/${id}`, 'PATCH', {cardStyle:{...style,constructor:'evil'}}, a.cookie)).status, 400);
  assert.equal((await call(`/api/requests/${id}`, 'PATCH', {cardStyle:{...style,theme:'url(evil)'}}, a.cookie)).status, 400);
  assert.equal((await call(`/api/requests/${id}`, 'PATCH', {cardStyle:style}, a.cookie)).status, 200);
  const richStyle = {...style, background:'mountain',shape:'polaroid'};
  assert.equal((await call(`/api/requests/${id}`, 'PATCH', {cardStyle:richStyle}, a.cookie)).status, 200);
  const legacyStyle = await call(`/api/requests/${id}`, 'PATCH', {cardStyle:{...style,theme:'sky'}}, a.cookie);
  assert.deepEqual(legacyStyle.data.request.cardStyle,{...richStyle,theme:'sky',coverPosition:'center'});
  await call(`/api/requests/${id}`, 'PATCH', {cardStyle:{...style,background:'none',shape:'standard',coverPosition:'center'}}, a.cookie);

  const help = await call('/api/clarify', 'POST', {message:'Excel 如何求和？'}, a.cookie);
  assert.equal(help.data.intent, 'help'); assert.equal(help.data.hasCard, false);
  assert.ok(!help.data.reply.includes('SUM'));
  assert.ok((await call('/api/me/requests', 'GET', null, a.cookie)).data.drafts.some(d=>d.id===help.data.request.id&&d.conversationTitle==='Excel 如何求和？'));
  const localStyle = await call('/api/clarify', 'POST', {requestId:help.data.request.id,message:'把卡片样式改为蓝色海报'}, a.cookie);
  assert.equal(localStyle.data.request.cardStyle.theme,'sky'); assert.equal(localStyle.data.request.cardStyle.layout,'poster');
  assert.equal(localStyle.data.hasCard,false);
  for (const color of ['橙色', '橘色', 'orange']) {
    const updated = await call('/api/clarify', 'POST', {requestId:help.data.request.id,message:`换成${color}`}, a.cookie);
    assert.equal(updated.data.intent,'style'); assert.equal(updated.data.request.cardStyle.theme,'orange');
  }
  for (const question of ['显卡驱动怎么用', '帮我写邮件', '帮我翻译', '帮我润色']) {
    const answer = await call('/api/clarify', 'POST', {message:question}, a.cookie);
    assert.equal(answer.data.intent,'help'); assert.equal(answer.data.hasCard,false);
    assert.match(answer.data.reply,/未连接 AI/);
  }
  for (const [color,expected] of [['深蓝','ink'],['藏蓝','ink'],['蓝色','sky'],['天蓝','sky']]) {
    const answer = await call('/api/clarify', 'POST', {requestId:help.data.request.id,message:`把卡片改成${color}`}, a.cookie);
    assert.equal(answer.data.request.cardStyle.theme,expected);
  }
  const mixed = await call('/api/clarify', 'POST', {message:'发布Excel互助需求，并把卡片改成橙色便签'}, a.cookie);
  assert.equal(mixed.data.intent,'request'); assert.equal(mixed.data.hasCard,true);
  assert.equal(mixed.data.request.status,'draft');
  assert.equal(mixed.data.request.cardStyle.theme,'orange'); assert.equal(mixed.data.request.cardStyle.layout,'note');
  const afterQuestion = await call('/api/clarify', 'POST', {message:'显卡驱动怎么用'}, a.cookie);
  const labeled = await call('/api/clarify', 'POST', {requestId:afterQuestion.data.request.id, message:'标题：样式卡片验收-123\n问题：需要核对名单\n目标：列出漏项\n交付物：差异清单\n技能：Excel'}, a.cookie);
  assert.equal(labeled.data.intent,'request'); assert.equal(labeled.data.readyForPreview,true);
  assert.equal(labeled.data.request.title,'样式卡片验收-123');
  assert.equal(labeled.data.request.problem,'需要核对名单');
  assert.equal(labeled.data.request.desiredOutcome,'列出漏项');
  assert.deepEqual(labeled.data.request.deliverables,['差异清单']); assert.deepEqual(labeled.data.request.skills,['Excel']);
  const labelAndStyle = await call('/api/clarify', 'POST', {message:'标题：设计卡片\n问题：整理名单\n目标：找出漏项\n交付物：清单\n把卡片改成蓝色便签'}, a.cookie);
  assert.equal(labelAndStyle.data.intent,'request'); assert.equal(labelAndStyle.data.request.title,'设计卡片');
  assert.equal(labelAndStyle.data.request.cardStyle.theme,'sky'); assert.equal(labelAndStyle.data.request.cardStyle.layout,'note');
  for (const [phrase,background] of [['把卡片背景换成山景','mountain'],['换成海边背景','coast'],['用摸鱼表情包做背景','meme'],['去掉背景图，改成纯色','none'],['换成山峰背景','mountain'],['换成海岸背景','coast']]) {
    const result = await call('/api/clarify', 'POST', {requestId:help.data.request.id,message:phrase}, a.cookie);
    assert.equal(result.data.intent,'style'); assert.equal(result.data.request.cardStyle.background,background);
  }
  const combination = await call('/api/clarify', 'POST', {requestId:help.data.request.id,message:'把卡片做成海边拍立得'}, a.cookie);
  assert.equal(combination.data.intent,'style'); assert.equal(combination.data.request.cardStyle.background,'coast');
  assert.equal(combination.data.request.cardStyle.shape,'polaroid'); assert.equal(combination.data.request.cardStyle.theme,'sky');
  for (const [phrase,shape] of [['改成票根','ticket'],['换成车票','ticket'],['改成照片框','polaroid'],['改成气泡','bubble'],['换成对话框','bubble'],['改成标准轮廓','standard']]) {
    const result = await call('/api/clarify', 'POST', {requestId:help.data.request.id,message:phrase}, a.cookie);
    assert.equal(result.data.intent,'style'); assert.equal(result.data.request.cardStyle.shape,shape); assert.equal(result.data.request.cardStyle.background,'coast');
  }
  assert.equal((await call(`/api/requests/${id}`, 'PATCH', {cardStyle:{...style,shape:'polygon(0 0)'}}, a.cookie)).status,400);
  const landscapeQuestion = await call('/api/clarify', 'POST', {requestId:help.data.request.id,message:'山景摄影怎么用光？'}, a.cookie);
  assert.equal(landscapeQuestion.data.intent,'help'); assert.equal(landscapeQuestion.data.request.cardStyle.background,'coast');
  const backgroundQuestion = await call('/api/clarify', 'POST', {requestId:help.data.request.id,message:'山景背景怎么用？'}, a.cookie);
  assert.equal(backgroundQuestion.data.intent,'help'); assert.equal(backgroundQuestion.data.request.cardStyle.background,'coast');
  assert.equal((await call(`/api/requests/${id}`, 'PATCH', {cardStyle:{...style,background:'https://example.com/x.png'}}, a.cookie)).status,400);
  const savedHelp = await call('/api/clarify', 'POST', {requestId:id,message:'Excel 如何求和？'}, a.cookie);
  assert.equal(savedHelp.data.intent,'help'); assert.equal(savedHelp.data.request.problem,draft.data.request.problem);

  assert.equal(
    (await call(`/api/requests/${id}`, "GET", null, b.cookie)).status,
    404,
  );
  assert.equal(
    (await call(`/api/requests/${id}/messages`, "GET", null, b.cookie)).status,
    404,
  );
  assert.equal(
    (await call(`/api/requests/${id}`, "PATCH", { title: "窃取" }, b.cookie))
      .status,
    404,
  );
  assert.equal(
    (
      await call(
        `/api/requests/${id}`,
        "PATCH",
        { source: "official" },
        a.cookie,
      )
    ).status,
    400,
  );
  const second = await call(
    "/api/clarify",
    "POST",
    { requestId: id, message: "目标：得到清晰表格\n交付物：整理后的文件" },
    a.cookie,
  );
  assert.equal(second.data.readyForPreview, true);
  assert.equal(second.data.messages.length, 6);
  assert.equal(
    (
      await call(
        `/api/requests/${id}`,
        "PATCH",
        { anonymous: true, materials: ["私密材料"] },
        a.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await call(`/api/requests/${id}/publish`, "POST", {}, a.cookie)).status,
    400,
  );
  const pub = await call(
    `/api/requests/${id}/publish`,
    "POST",
    { confirmed: true },
    a.cookie,
  );
  assert.equal(pub.status, 200);
  assert.ok(pub.data.matching);assert.ok(['running','pending','done'].includes(pub.data.matching.status));
  const publicCard = await call(`/api/requests/${id}`);
  assert.equal(publicCard.data.request.owner, null);
  assert.deepEqual(publicCard.data.request.cardStyle, {...style,background:'none',shape:'standard',coverPosition:'center'});
  assert.deepEqual(publicCard.data.request.materials, []);
  assert.ok(!JSON.stringify(publicCard.data).includes("alice"));
  assert.ok(!JSON.stringify(publicCard.data).includes("私密材料"));
  assessPublishedTask(dir,id);
  const claims = await Promise.all([
    call(`/api/requests/${id}/claim`, "POST", {}, b.cookie),
    call(`/api/requests/${id}/claim`, "POST", {}, c.cookie),
  ]);
  assert.deepEqual(claims.map((x) => x.status).sort(), [200, 409]);
  assert.equal(
    (await call(`/api/requests/${id}/claim`, "POST", {}, b.cookie)).status,
    409,
  );
  const board = await call("/api/requests?source=official");
  assert.ok(board.data.requests.length >= 3);
  assert.ok(
    board.data.requests.every((x) => x.isDemo && x.source === "official"),
  );
  const demo = (await call("/api/requests?source=employee")).data.requests.find(
    (x) => x.isDemo,
  );
  assert.equal(
    (await call(`/api/requests/${demo.id}/claim`, "POST", {}, b.cookie)).status,
    200,
  );
  const mine = await call("/api/me/requests", "GET", null, a.cookie);
  assert.equal(mine.data.requests.length, 1);
});

test("来源检查、私密发布、会话及重启持久化", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "momoyu-restart-"));
  let child;
  async function start() {
    child = spawn(process.execPath, ["server/index.mjs"], {
      env: { ...process.env, DATA_DIR: dir, PORT: "0", DIFY_API_KEY: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    for await (const chunk of child.stdout) {
      output += chunk;
      const match = output.match(/"port":(\d+)/);
      if (match) return `http://127.0.0.1:${match[1]}`;
    }
    throw new Error("服务器未能启动");
  }
  async function stop() {
    if (child && child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
  }
  t.after(async () => {
    await stop();
    rmSync(dir, { recursive: true, force: true });
  });
  let base = await start();
  async function call(path, method = "GET", data, cookie, headers = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(method !== "GET" ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  assert.equal((await call("/api/auth/login", "POST", {})).status, 400);
  assert.equal(
    (await call("/api/auth/login", "POST", { username: "x" })).status,
    400,
  );
  assert.equal(
    (
      await call("/api/auth/register", "POST", {}, null, {
        origin: "http://evil.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/api/auth/register", "POST", {}, null, {
        "content-type": "text/plain",
      })
    ).status,
    415,
  );
  const account = await call(
    "/api/auth/register",
    "POST",
    {
      username: "persist",
      password: "password123",
      displayName: "持久",
      department: "测试",
    },
    null,
    { origin: base },
  );
  assert.equal(account.status, 201);
  const draft = await call(
    "/api/clarify",
    "POST",
    { message: "问题：问题\n目标：目标\n交付物：文件" },
    account.cookie,
  );
  assert.equal(draft.data.request.fallbackToBoard, false);
  const id = draft.data.request.id;
  await call(
    `/api/requests/${id}`,
    "PATCH",
    { visibility: "private" },
    account.cookie,
  );
  assert.equal(
    (
      await call(
        `/api/requests/${id}/publish`,
        "POST",
        { confirmed: true },
        account.cookie,
      )
    ).data.error.code,
    "PRIVATE_DRAFT",
  );
  await call(
    `/api/requests/${id}`,
    "PATCH",
    { visibility: "company" },
    account.cookie,
  );
  assert.equal(
    (
      await call(
        `/api/requests/${id}/publish`,
        "POST",
        { confirmed: true },
        account.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        `/api/requests/${id}/publish`,
        "POST",
        { confirmed: true },
        account.cookie,
      )
    ).status,
    409,
  );
  assert.equal(
    (await call(`/api/requests/${id}/claim`, "POST", {})).status,
    401,
  );
  const board = await call("/api/requests?source=official");
  const announcement = board.data.requests.find(
    (x) => x.kind === "announcement",
  );
  assert.equal(
    (
      await call(
        `/api/requests/${announcement.id}/claim`,
        "POST",
        {},
        account.cookie,
      )
    ).status,
    400,
  );
  await stop();
  const legacyDb = new DatabaseSync(join(dir, 'momoyu.sqlite'));
  const legacyRow = legacyDb.prepare('SELECT data FROM requests WHERE id=?').get(id);
  const legacyData = JSON.parse(legacyRow.data);
  delete legacyData.cardStyle;
  legacyDb.prepare('UPDATE requests SET data=? WHERE id=?').run(JSON.stringify(legacyData), id);
  legacyDb.close();
  base = await start();
  assert.deepEqual((await call(`/api/requests/${id}`)).data.request.cardStyle, DEFAULT_CARD_STYLE);
  assert.equal(
    (await call("/api/session", "GET", undefined, account.cookie)).data.user
      .username,
    "persist",
  );
  assert.equal((await call(`/api/requests/${id}`)).data.request.title, "问题");
  const expired = await call("/api/auth/login", "POST", {
    username: "persist",
    password: "password123",
  });
  const db = new DatabaseSync(join(dir, "momoyu.sqlite"));
  db.prepare("UPDATE sessions SET expires_at=0 WHERE token=?").run(
    expired.cookie.slice("session=".length),
  );
  db.close();
  assert.equal(
    (await call("/api/session", "GET", undefined, expired.cookie)).data.user,
    null,
  );
  assert.equal(
    (await call("/api/auth/logout", "POST", {}, account.cookie)).status,
    200,
  );
  assert.equal(
    (await call("/api/session", "GET", undefined, account.cookie)).data.user,
    null,
  );
});
