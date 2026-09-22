  // 通用复制函数：Clipboard API + execCommand 兜底
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove();
    }
  }

  // 埋点函数：发布自定义事件，等待 analytics 加载器接管
  function track(eventName, props = {}) {
    document.dispatchEvent(new CustomEvent('ga-event', { detail: { event: eventName, ...props } }));
  }

  // Toast 提示
  function showToast(msg, isError = false) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.style.background = isError ? '#7f1d1d' : 'var(--panel)';
    toast.style.borderColor = isError ? '#ef444466' : 'var(--accent-66)';
    toast.style.color = isError ? '#fca5a5' : 'var(--accent)';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  // 1) 移动端菜单：开合 + 点链接后收起 + 焦点陷阱
  const menuBtn = document.getElementById('menuBtn');
  const mobileMenu = document.getElementById('mobileMenu');
  let lastFocused = null;
  menuBtn.addEventListener('click', () => {
    const expanded = menuBtn.getAttribute('aria-expanded') === 'true';
    menuBtn.setAttribute('aria-expanded', !expanded);
    mobileMenu.classList.toggle('hidden');
    if (!expanded) {
      lastFocused = document.activeElement;
      mobileMenu.querySelector('a, button')?.focus();
    } else {
      lastFocused?.focus();
    }
  });
  mobileMenu.querySelectorAll('a, button').forEach(el =>
    el.addEventListener('click', () => {
      mobileMenu.classList.add('hidden');
      menuBtn.setAttribute('aria-expanded', 'false');
      lastFocused?.focus();
    }));

  // 焦点陷阱
  mobileMenu.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || mobileMenu.classList.contains('hidden')) return;
    const focusable = mobileMenu.querySelectorAll('a, button');
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // 2) 联系方式复制按钮 + aria-label
  document.querySelectorAll('.copyBtn').forEach(btn => {
    const label = btn.dataset.copy.includes('@') ? '复制邮箱' : '复制电话/微信';
    btn.setAttribute('aria-label', label);
    btn.addEventListener('click', async () => {
      await copyText(btn.dataset.copy);
      btn.textContent = '已复制 ✓';
      setTimeout(() => (btn.textContent = '点击复制'), 1500);
    });
  });

  // 3) 咨询弹窗：所有 .consultBtn 打开；✕ / 点遮罩 / ESC 关闭
  const modal = document.getElementById('consultModal');
  const openModal = () => { modal.classList.remove('hidden'); document.body.style.overflow = 'hidden'; document.getElementById('fNeed').focus(); };
  const closeModal = () => { modal.classList.add('hidden'); document.body.style.overflow = ''; };
  document.querySelectorAll('.consultBtn').forEach(b =>
    b.addEventListener('click', () => { mobileMenu.classList.add('hidden'); menuBtn.setAttribute('aria-expanded', 'false'); openModal(); track('consult_open', { cta: b.dataset.cta || 'unknown' }); }));
  document.getElementById('modalClose').addEventListener('click', closeModal);
  modal.querySelector('[data-close-modal]').addEventListener('click', closeModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal(); });

  // 4) 表单提交：Formspree 真实后端 + loading 态 + Toast
  const form = document.getElementById('consultForm');
  const submitBtn = document.getElementById('submitBtn');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const need = document.getElementById('fNeed').value.trim();
    if (!need) { document.getElementById('fNeed').focus(); return; }

    submitBtn.classList.add('loading');
    submitBtn.textContent = '提交中…';

    try {
      const formData = new FormData(form);
      const resp = await fetch(form.action, {
        method: 'POST',
        body: formData,
        headers: { 'Accept': 'application/json' }
      });
      if (resp.ok) {
        showToast('✅ 咨询已发送，我会尽快回复您');
        track('form_submit', { result: 'success' });
        form.reset();
        closeModal();
      } else {
        const data = await resp.json().catch(() => ({}));
        showToast(`❌ 提交失败：${data.error || '请稍后重试'}`, true);
        track('form_submit', { result: 'error' });
      }
    } catch (err) {
      showToast('❌ 网络错误，请检查连接或改用微信联系', true);
    } finally {
      submitBtn.classList.remove('loading');
      submitBtn.textContent = '提交咨询';
    }
  });

  // 5) 微信复制按钮（保留原逻辑）
  document.getElementById('wxBtn').addEventListener('click', async () => {
    const name = document.getElementById('fName').value.trim() || '（未填写）';
    const way  = document.getElementById('fWay').value.trim()  || '（未填写）';
    const need = document.getElementById('fNeed').value.trim();
    if (!need) { document.getElementById('fNeed').focus(); return; }
    const msg = `【项目咨询】\n称呼：${name}\n联系方式：${way}\n需求描述：${need}`;
       await copyText(msg);
    document.getElementById('wxDone').classList.remove('hidden');
    track('copy_wechat');
    setTimeout(() => document.getElementById('wxDone').classList.add('hidden'), 4000);
  });

  // 6) 所有咨询按钮点击态反馈
  document.querySelectorAll('.consultBtn').forEach(btn => {
    btn.addEventListener('mousedown', () => btn.style.transform = 'scale(0.98)');
    btn.addEventListener('mouseup', () => btn.style.transform = '');
    btn.addEventListener('mouseleave', () => btn.style.transform = '');
  });

  // 7) 显示构建时间
  const buildMeta = document.querySelector('meta[name="build-time"]');
  if (buildMeta) {
    const buildEl = document.getElementById('buildInfo');
    if (buildEl) {
      const ts = buildMeta.content;
      buildEl.textContent = `Build ${ts}`;
      buildEl.title = `构建时间：${ts}`;
    }
  }
