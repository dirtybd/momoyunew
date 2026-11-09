import { test, expect } from '@playwright/test';

async function register(page, suffix) {
  await page.getByRole('button', { name: '登录 / 注册', exact: true }).click();
  await page.getByRole('button', { name: '注册与建档', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '创建账号与档案' });
  await expect(dialog.getByText('至少 8 个字符', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('密码', { exact: true })).toHaveAccessibleDescription('至少 8 个字符');
  await dialog.getByLabel('账号', { exact: true }).fill('journey-' + suffix);
  await dialog.getByLabel('密码', { exact: true }).fill('LocalTest-2026');
  await dialog.getByLabel('姓名', { exact: true }).fill('测试同事' + suffix);
  await dialog.getByLabel('部门', { exact: true }).fill('本地验收组');
  await dialog.getByLabel('擅长技能（逗号分隔）').fill('Excel，信息整理');
  await dialog.getByLabel('空闲时间', { exact: true }).fill('每天15分钟');
  await dialog.getByRole('button', { name: '注册并创建档案', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test('注册建档、对话与卡片、匿名公屏、另一个账号接取并持久保留', async ({ page, browser }) => {
  const stamp = Date.now().toString();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '互助公屏', exact: true })).toBeVisible();
  await register(page, stamp + 'a');
  await page.getByRole('button', { name: '＋ 发起需求', exact: true }).click();
  await expect(page.getByText('本地引导 · AI 未连接', { exact: false }).first()).toBeVisible();
  await page.getByLabel('你的任务', { exact: true }).fill('问题：两份名单需要核对漏项\n目标：列出缺失记录\n交付物：差异清单\n技能：Excel');
  await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
  await page.getByText('编辑需求内容', { exact: true }).click();
  await expect(page.getByLabel('遇到的困扰', { exact: true })).toHaveValue('两份名单需要核对漏项');
  const title = '名单核对验收-' + stamp;
  await page.getByLabel('标题', { exact: true }).fill(title);
  await page.getByLabel('公屏匿名展示').check();
  await page.getByText('编辑需求内容', { exact: true }).click();
  await page.screenshot({ path: '.taste-skill/inspect-journey/clarify-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('草稿已保存。', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: /预览并发布/ }).click();
  const confirm = page.getByRole('dialog', { name: '确认发布到公屏' });
  await expect(confirm.getByText(title, { exact: true })).toBeVisible();
  await confirm.getByRole('button', { name: '确认发布', exact: true }).click();
  await expect(confirm).not.toBeVisible();
  await page.getByRole('searchbox', { name: '搜索需求' }).fill(title);
  const row = page.locator('.request-row').filter({ hasText: title });
  await expect(row).toContainText('匿名同事');
  await expect(row).not.toContainText('本地验收组');
  await page.reload();
  await page.getByRole('searchbox', { name: '搜索需求' }).fill(title);
  await expect(page.locator('.request-row').filter({ hasText: title })).toBeVisible();

  const second = await browser.newContext({ baseURL: 'http://127.0.0.1:8791' });
  const helper = await second.newPage();
  await helper.goto('/');
  await register(helper, stamp + 'b');
  await helper.getByRole('searchbox', { name: '搜索需求' }).fill(title);
  await helper.locator('.request-row').filter({ hasText: title }).click();
  const detail = helper.getByRole('dialog', { name: '需求详情' });
  await expect(detail).toContainText('匿名同事');
  await detail.getByRole('button', { name: '接取这个需求', exact: true }).click();
  await expect(detail).toContainText('你已接取此需求');
  await helper.reload();
  await helper.getByRole('searchbox', { name: '搜索需求' }).fill(title);
  await expect(helper.locator('.request-row').filter({ hasText: title })).toContainText('进行中');
  await second.close();
  expect(errors).toEqual([]);
});

test('档案修改保存、私密草稿不误发布、自然语言日期不崩溃', async ({ page }) => {
  const stamp = Date.now().toString();
  await page.goto('/');
  await register(page, stamp + 'p');
  await page.locator('.account').click();
  await page.getByLabel('个人简介', { exact: true }).fill('愿意帮助核对表格。');
  await page.getByRole('button', { name: '保存档案', exact: true }).click();
  await expect(page.getByText('档案已保存。', { exact: false }).first()).toBeVisible();
  await page.reload();
  await page.locator('.account').click();
  await expect(page.getByLabel('个人简介', { exact: true })).toHaveValue('愿意帮助核对表格。');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: /AI 办公/ }).click();
  await page.getByLabel('你的任务').fill('问题：私密任务\n目标：核对记录\n交付物：一份清单\n截止时间：下周三');
  await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
  await page.getByText('编辑需求内容', { exact: true }).click();
  await page.getByRole('combobox', { name: /可见范围/ }).selectOption('private');
  await page.getByRole('button', { name: /预览并发布/ }).click();
  await expect(page.getByRole('alert')).toContainText('不能发布');
  await expect(page.getByRole('dialog', { name: '确认发布到公屏' })).not.toBeVisible();
});

test('手机公屏无横向溢出、卡片详情可读、减少动态时仍可浏览', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '互助公屏', exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.locator('.request-row').first().click();
  await expect(page.getByRole('dialog', { name: '需求详情' })).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '暂停滚动', exact: true }).click();
  await expect(page.getByRole('button', { name: '继续滚动', exact: true })).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.marquee-card').first()).toBeVisible();
  await expect(page.locator('.marquee-track').first()).toHaveCSS('animation-name','none');
});
