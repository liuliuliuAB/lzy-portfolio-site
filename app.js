(() => {
  'use strict';

  const canvas = document.querySelector('#site-canvas');
  const toast = document.querySelector('.toast');
  const isLocal = ['127.0.0.1', 'localhost'].includes(location.hostname);
  let data;
  let editing = false;
  let activeTab = 'theme';
  let selectedSection = 'hero';
  let selectedWork = 'work-01';
  let toastTimer;
  let revealObserver;
  let lightboxCleanup;
  let selectedTextKey = '';
  let selectedTextLabel = '';
  let selectedTextDefaults = null;
  let localFonts = [];

  const esc = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  const idText = value => String(value).replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const get = (path) => path.split('.').reduce((item, key) => item?.[key], data);
  const set = (path, value) => {
    const parts = path.split('.');
    const last = parts.pop();
    const parent = parts.reduce((item, key) => item[key], data);
    parent[last] = value;
  };
  const workIndex = id => data.works.findIndex(work => work.id === id);
  const pathForWork = (id, suffix = '') => `works.${workIndex(id)}${suffix}`;
  const section = id => data.sections.find(item => item.id === id);
  const sectionPath = (id, suffix = '') => `sections.${data.sections.findIndex(item => item.id === id)}${suffix}`;
  const customSection = id => data.customSections.find(item => item.id === id);
  const block = id => section(id) || customSection(id);
  const blockPath = id => {
    const coreIndex = data.sections.findIndex(item => item.id === id);
    return coreIndex >= 0 ? `sections.${coreIndex}` : `customSections.${data.customSections.findIndex(item => item.id === id)}`;
  };
  const orderedBlocks = () => {
    const all = [...data.sections, ...data.customSections];
    const ids = data.pageOrder || all.map(item => item.id);
    return ids.map(id => all.find(item => item.id === id)).filter(Boolean);
  };
  const editable = (path, value, tag = 'span', attrs = '') => `<${tag} data-edit-path="${esc(path)}" ${attrs}>${esc(value ?? '')}</${tag}>`;
  const projectColor = value => /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#aa5844';
  const projectStages = (work, wi, compact = false) => `<div class="project-stages ${compact ? 'project-stages--compact' : ''}" aria-label="项目制作阶段">${(work.stages || []).filter(Boolean).map((stage, si) => `<span>${editable(`works.${wi}.stages.${si}`, stage)}</span>`).join('')}</div>`;
  const directText = node => [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent).join(' ').replace(/\s+/g, ' ').trim();
  const textDomPath = node => {
    const parts = [];
    let current = node;
    while (current && current !== canvas) {
      const siblings = current.parentElement ? [...current.parentElement.children].filter(item => item.tagName === current.tagName) : [];
      parts.unshift(`${current.tagName.toLowerCase()}:${siblings.indexOf(current) + 1}`);
      current = current.parentElement;
    }
    return parts.join('/');
  };
  const colorToHex = value => {
    if (/^#[0-9a-f]{6}$/i.test(value || '')) return value.toLowerCase();
    const channels = String(value || '').match(/[\d.]+/g)?.slice(0, 3).map(Number);
    return channels?.length === 3 ? `#${channels.map(channel => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('')}` : '#f0eee8';
  };
  const applyTextStyle = (node, style = {}) => {
    const family = String(style.fontFamily || '').trim().replace(/^['"]|['"]$/g, '');
    node.style.fontFamily = family ? `"${family.replace(/"/g, '\\"')}", var(--font)` : '';
    node.style.fontSize = style.fontSize ? `${style.fontSize}px` : '';
    node.style.color = style.color || '';
    node.style.fontWeight = style.fontWeight || '';
    node.style.fontStyle = style.fontStyle || '';
    node.style.textDecoration = style.textDecoration || '';
    node.style.letterSpacing = style.letterSpacing !== undefined && style.letterSpacing !== '' ? `${style.letterSpacing}px` : '';
    node.style.lineHeight = style.lineHeight || '';
  };

  function prepareTextTargets() {
    data.textStyles ||= {};
    canvas.querySelectorAll('*').forEach(node => {
      const label = directText(node);
      if (!label || ['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(node.tagName)) return;
      const anchor = node.closest('[id]');
      const scope = anchor?.id || (node.closest('.site-footer') ? 'footer' : 'page');
      const key = node.dataset.editPath ? `${scope}:edit:${node.dataset.editPath}` : `${scope}:fixed:${textDomPath(node)}`;
      node.dataset.textTarget = '';
      node.dataset.textStyleKey = key;
      node.dataset.textLabel = label.slice(0, 80);
      applyTextStyle(node, data.textStyles[key]);
      node.classList.toggle('text-style-selected', editing && key === selectedTextKey);
    });
  }

  function currentTextDefaults(node) {
    const style = getComputedStyle(node);
    return {
      fontFamily: style.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
      fontSize: Math.round(parseFloat(style.fontSize) * 10) / 10,
      color: colorToHex(style.color),
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      textDecoration: style.textDecorationLine === 'none' ? 'none' : style.textDecorationLine,
      letterSpacing: style.letterSpacing === 'normal' ? 0 : Math.round(parseFloat(style.letterSpacing) * 10) / 10,
      lineHeight: style.lineHeight === 'normal' ? 1.2 : Math.round((parseFloat(style.lineHeight) / parseFloat(style.fontSize)) * 100) / 100
    };
  }

  function selectTextTarget(node) {
    selectedTextKey = node.dataset.textStyleKey;
    selectedTextLabel = node.dataset.textLabel || directText(node);
    selectedTextDefaults = currentTextDefaults(node);
    canvas.querySelectorAll('.text-style-selected').forEach(item => item.classList.remove('text-style-selected'));
    node.classList.add('text-style-selected');
    activeTab = 'text';
    renderBuilder();
  }

  const fontNames = () => [...new Set([data?.theme?.font, 'Microsoft YaHei UI', 'Microsoft YaHei', 'DengXian', 'SimHei', 'SimSun', 'KaiTi', 'FangSong', 'Arial', 'Arial Black', 'Georgia', 'Times New Roman', ...localFonts].filter(Boolean))];
  const fontDatalist = () => `<datalist id="local-font-list">${fontNames().map(font => `<option value="${esc(font)}"></option>`).join('')}</datalist>`;
  const textStyleValue = (key, fallback = '') => data.textStyles?.[selectedTextKey]?.[key] ?? selectedTextDefaults?.[key] ?? fallback;

  async function loadLocalFonts() {
    const names = [];
    try {
      const response = await fetch('/api/fonts', { cache: 'no-store' });
      if (response.ok) names.push(...((await response.json()).fonts || []));
    } catch { /* Browser font access below remains available as a fallback. */ }
    if (!names.length && 'queryLocalFonts' in window) try {
      const fonts = await window.queryLocalFonts();
      names.push(...fonts.map(font => font.family));
    } catch (error) {
      if (!names.length && error?.name === 'NotAllowedError') return showToast('未获得本机字体访问权限');
    }
    localFonts = [...new Set(names.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    if (localFonts.length) {
      renderBuilder();
      showToast(`已读取 ${localFonts.length} 种本机字体`);
    } else showToast('没有读取到字体，请确认正在使用 4174 本地编辑服务');
  }

  canvas.addEventListener('click', event => {
    if (!editing) return;
    if (event.target.closest('.slot-editor, [data-upload-trigger], [data-clear-image], .drag-handle, .resize-handle')) return;
    const node = event.target.closest('[data-text-target]');
    if (!node || !canvas.contains(node)) return;
    selectTextTarget(node);
    if (node.closest('a, button')) {
      event.preventDefault();
      event.stopPropagation();
      if (node.dataset.editPath) node.focus();
    }
  }, true);

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2100);
  }

  function applyTheme() {
    const t = data.theme;
    const root = document.documentElement.style;
    root.setProperty('--bg', t.background);
    root.setProperty('--surface', t.surface);
    root.setProperty('--text', t.text);
    root.setProperty('--muted', t.muted);
    root.setProperty('--accent', t.accent);
    root.setProperty('--font', `"${t.font}", system-ui, sans-serif`);
    root.setProperty('--space', `${t.baseSpacing}px`);
    root.setProperty('--duration', `${t.animationDuration}ms`);
  }

  function mediaLayoutStyle(layoutPath) {
    const layout = get(layoutPath) || {};
    const width = Number(layout.width);
    const height = Number(layout.height);
    const x = Number(layout.x) || 0;
    const y = Number(layout.y) || 0;
    return `--media-x:${x}px;--media-y:${y}px;${width > 0 ? `width:${width}px;` : ''}${height > 0 ? `height:${height}px;aspect-ratio:auto;` : ''}`;
  }

  function slot({ src, fit = 'contain', label, title, hint, path, layoutPath, size = '拖入或点击上传图片' }) {
    const image = src ? `<img src="${esc(src)}" alt="${esc(title || label || '作品图片')}" data-auto-fit-image style="object-fit:${esc(fit)}">` : '';
    return `<div class="media-slot editor-adjustable ${src ? 'has-image' : ''}" data-auto-fit data-upload-path="${esc(path)}" data-layout-path="${esc(layoutPath)}" style="${mediaLayoutStyle(layoutPath)}">
      ${image}
      <div class="slot-copy"><span>${esc(label || 'IMAGE SLOT')}</span><strong>${esc(title || '图片展示栏')}</strong><small>${esc(hint || '可在编辑模式上传')}</small></div>
      <small class="slot-size">${esc(size)}</small>
      <div class="slot-editor"><div><button type="button" data-upload-trigger="${esc(path)}">上传 / 替换图片</button><button type="button" data-clear-image="${esc(path)}">清除图片</button></div><span class="drag-handle" title="拖动窗口位置">↕</span><span class="resize-handle" title="拖动调整窗口尺寸"></span></div>
    </div>`;
  }

  function renderHero(item) {
    const p = data.profile;
    return `<section id="hero" class="site-section hero ${motion(item)}" style="--section-pad:${item.padding}px">
      <div class="hero-copy">
        <p class="eyebrow">PORTFOLIO / 2026—2027</p>
        <h1>${editable('profile.role', p.role, 'span')}</h1>
        <p class="hero-intro">${editable('profile.intro', p.intro || '专注二次元角色模型制作，\n覆盖角色建模、UV、手绘贴图、实时渲染流程。\n\n除传统模型制作外，也研究 Unity Shader 与角色表现。', 'span')}</p>
        <div class="hero-actions">
          <a class="text-link" href="#works">查看精选作品 <span>↘</span></a>
          <button type="button" class="text-link" data-contact-toggle>联系我 <span>↗</span></button>
        </div>
        <div class="hero-meta"><div><span>方向</span><strong>${editable('profile.direction', p.direction || '二次元 / 风格化角色')}</strong></div><div><span>求职</span><strong>${editable('profile.jobTarget', p.jobTarget || '27 届校招 / 角色模型')}</strong></div><div><span>地点</span><strong>${editable('profile.location', p.location || '中国 / 可到岗')}</strong></div></div>
      </div>
      <div class="hero-media">${slot({ src: p.heroImage || './assets/images/hero-cover-1786260572621.png', fit: p.heroFit || 'contain', label:'01 / HERO COVER', title:'首屏角色主视觉', hint:'建议放置半身或全身渲染图', path:'profile.heroImage', layoutPath:'profile.heroLayout', size:'建议 2400 × 1600' })}</div>
    </section>`;
  }

  function renderWorks(item) {
    const works = data.works.map((work, i) => {
      const hasBreakdown = work.breakdownEnabled !== false;
      const mediaStart = hasBreakdown
        ? `<a class="work-media" href="#${esc(work.id)}" aria-label="查看 ${esc(work.title)} 的项目拆解">`
        : '<div class="work-media work-media--static">';
      const mediaEnd = hasBreakdown ? '</a>' : '</div>';
      return `<article class="work-card" id="card-${esc(work.id)}" style="--project-accent:${projectColor(work.accent)}">
        ${mediaStart}
          <span class="work-index">0${i + 1}</span>${hasBreakdown ? '<span class="work-open">查看拆解 ↘</span>' : ''}
          ${slot({ ...work.cover, label:work.type, title:work.title, hint:'点击上传你的作品封面', path:`${pathForWork(work.id)}.cover.src`, layoutPath:`${pathForWork(work.id)}.cover.layout`, size:hasBreakdown ? '点击后跳转项目拆解' : '精选作品展示' })}
        ${mediaEnd}
        <div class="work-info"><div class="work-title-block"><p class="work-type">${editable(`${pathForWork(work.id)}.type`, work.type)}</p><h3>${editable(`${pathForWork(work.id)}.title`, work.title)}</h3>${projectStages(work, i, true)}</div><ul class="work-tags">${work.tags.map((tag, index) => ({ tag, index })).filter(item => item.tag).map(item => `<li>${editable(`${pathForWork(work.id)}.tags.${item.index}`, item.tag)}</li>`).join('')}</ul><p class="work-year">${editable(`${pathForWork(work.id)}.year`, work.year)}</p></div>
      </article>`;
    }).join('');
    return `<section id="works" class="site-section ${motion(item)}" style="--section-pad:${item.padding}px"><div class="section-head"><div><p class="eyebrow">01 / SELECTED WORKS</p><h2>${editable(sectionPath('works', '.title'), item.title, 'span')}</h2></div><p>${editable(sectionPath('works', '.intro'), item.intro, 'span')}</p></div><div class="works-list" data-layout="${esc(item.layout)}">${works}</div></section>`;
  }

  function renderBreakdowns(item) {
    const html = data.works.map((work, wi) => ({ work, wi })).filter(({ work }) => work.breakdownEnabled !== false).map(({ work, wi }) => {
      const visibleMedia = work.media.map((medium, mi) => ({ medium, mi })).filter(({ medium }) => !work.hideEmptyBreakdownMedia || Boolean(medium.src));
      const media = visibleMedia.map(({ medium, mi }) => {
        const zoomClass = medium.src ? ' breakdown-zoomable' : '';
        const zoomAttrs = medium.src ? ` data-lightbox-src="${esc(medium.src)}" data-lightbox-alt="${esc(medium.title || work.title)}" role="button" tabindex="0" aria-label="放大查看 ${esc(medium.title || work.title)}"` : '';
        return `<div class="media-cell${zoomClass}"${zoomAttrs}>${slot({ ...medium, path:`works.${wi}.media.${mi}.src`, layoutPath:`works.${wi}.media.${mi}.layout`, size:'上传拆解图' })}${medium.src ? '<span class="breakdown-zoom-hint" aria-hidden="true">放大查看 ＋</span>' : ''}</div>`;
      }).join('');
      const facts = work.facts.map((fact, fi) => `<div><span>${editable(`works.${wi}.facts.${fi}.0`, fact[0])}</span><strong>${editable(`works.${wi}.facts.${fi}.1`, fact[1])}</strong></div>`).join('');
      return `<article id="${esc(work.id)}" class="project-breakdown" style="--project-accent:${projectColor(work.accent)}"><header class="project-head"><span class="project-number">0${wi + 1}</span><div><p>${editable(`works.${wi}.type`, work.type)}</p><h3>${editable(`works.${wi}.title`, work.title)}</h3>${projectStages(work, wi)}</div><a href="#card-${esc(work.id)}">回到精选作品 ↑</a></header><div class="media-row" data-media-count="${visibleMedia.length}">${media}</div><div class="project-facts">${facts}</div></article>`;
    }).join('');
    return `<section id="breakdowns" class="site-section surface ${motion(item)}" style="--section-pad:${item.padding}px"><div class="section-head"><div><p class="eyebrow">02 / PROJECT BREAKDOWNS</p><h2>${editable(sectionPath('breakdowns', '.title'), item.title, 'span')}</h2></div><p>${editable(sectionPath('breakdowns', '.intro'), item.intro, 'span')}</p></div><div class="project-list">${html}</div></section>`;
  }

  function renderAbout(item) {
    const p = data.profile;
    const tools = p.tools.map((tool, i) => `<i>${editable(`profile.tools.${i}`, tool)}</i>`).join('');
    return `<section id="about" class="site-section ${motion(item)}" style="--section-pad:${item.padding}px"><div class="about-grid"><div class="about-copy"><p class="eyebrow">04 / ABOUT ME</p><h2>${editable(sectionPath('about', '.title'), item.title, 'span')}</h2><p class="about-lead">${editable('profile.aboutLead', p.aboutLead || '一名正在寻找 2027 届校招机会的二次元 3D 角色模型师。', 'span')}</p><p>${editable('profile.aboutDetail', p.aboutDetail || '关注角色从二维设定到三维落地时的造型还原，也喜欢研究面部表现、服装材质与实时渲染，让角色在游戏画面中保持清晰的表现力。', 'span')}</p></div><div class="about-data"><div class="about-row"><span>EDUCATION</span><div><strong>${editable('profile.school', p.school)}</strong><small>${editable('profile.education', p.education)}</small></div></div><div class="about-row"><span>FOCUS</span><div><strong>${editable('profile.focus', p.focus)}</strong><small>${editable('profile.focusDetail', p.focusDetail)}</small></div></div><div class="about-row"><span>TOOLS</span><div class="tool-cloud">${tools}</div></div><div class="about-row"><span>LANGUAGE</span><div><strong>${editable('profile.languages', p.languages)}</strong></div></div></div></div></section>`;
  }

  function renderContact(item) {
    const p = data.profile;
    return `<section id="contact" class="site-section contact ${motion(item)}" style="--section-pad:${item.padding}px"><div class="contact-head"><p class="eyebrow">05 / CONTACT</p><p>愿意提供完整项目文件与制作拆解。<br>欢迎通过以下方式联系我。</p></div><button class="contact-main" type="button" data-contact-toggle><strong>${editable(sectionPath('contact', '.title'), item.title, 'span')}</strong><span class="contact-toggle" aria-expanded="false">↗</span></button><div class="contact-panel"><div class="contact-meta"><button type="button" data-copy-email><span>EMAIL</span>${editable('profile.email', p.email)}<i>复制</i></button><a href="${esc(p.xiaohongshu)}" target="_blank" rel="noopener"><span>小红书</span>${editable('profile.xiaohongshu', p.xiaohongshu)}<i>↗</i></a><a href="${esc(p.bilibili)}" target="_blank" rel="noopener"><span>BILIBILI</span>${editable('profile.bilibili', p.bilibili)}<i>↗</i></a><a href="${esc(p.douyin)}" target="_blank" rel="noopener"><span>抖音</span>${editable('profile.douyin', p.douyin)}<i>↗</i></a></div></div></section>`;
  }

  function renderCustom(item) {
    if (item.type === 'gallery') {
      const cards = (item.items || []).map((card, i) => `<article class="custom-card">${slot({ src:card.src, title:card.title || '图片展示', hint:'点击上传图片', label:'GALLERY', path:`customSections.${data.customSections.indexOf(item)}.items.${i}.src`, layoutPath:`customSections.${data.customSections.indexOf(item)}.items.${i}.layout` })}<h3>${editable(`customSections.${data.customSections.indexOf(item)}.items.${i}.title`, card.title || '图片标题', 'span')}</h3></article>`).join('');
      return `<section id="${esc(item.id)}" class="site-section custom-section ${motion(item)}" style="--section-pad:${item.padding}px"><div class="section-head"><div><p class="eyebrow">CUSTOM / GALLERY</p><h2>${editable(`customSections.${data.customSections.indexOf(item)}.title`, item.title, 'span')}</h2></div><p>${editable(`customSections.${data.customSections.indexOf(item)}.content`, item.content, 'span')}</p></div><div class="custom-grid" style="--columns:${item.columns || 3}">${cards}</div></section>`;
    }
    return `<section id="${esc(item.id)}" class="site-section custom-section ${motion(item)}" style="--section-pad:${item.padding}px"><div class="section-head"><div><p class="eyebrow">CUSTOM / TEXT</p><h2>${editable(`customSections.${data.customSections.indexOf(item)}.title`, item.title, 'span')}</h2></div><p>${editable(`customSections.${data.customSections.indexOf(item)}.content`, item.content, 'span')}</p></div></section>`;
  }

  function motion(item) { return data.theme.animationsEnabled && item.animation !== 'none' ? `motion-${item.animation}` : ''; }
  function render() {
    closeLightbox();
    applyTheme();
    const renderers = { hero:renderHero, works:renderWorks, breakdowns:renderBreakdowns, about:renderAbout, contact:renderContact };
    const page = orderedBlocks().filter(item => item.enabled !== false).map(item => renderers[item.type]?.(item) || renderCustom(item)).join('');
    canvas.innerHTML = `${page}<footer class="site-footer"><span>© ${new Date().getFullYear()} ${esc(data.profile.name)} · 可编辑作品集 v0.1</span><a href="#hero">返回顶部 ↑</a></footer>`;
    canvas.classList.toggle('editing', editing);
    prepareTextTargets();
    bindCanvas();
    bindMotion();
    if (isLocal) renderBuilder();
  }

  function bindCanvas() {
    document.querySelectorAll('[data-edit-path]').forEach(node => {
      if (!editing) return;
      node.contentEditable = 'true';
      node.spellcheck = false;
      node.addEventListener('blur', () => {
        const path = node.dataset.editPath;
        set(path, node.textContent.trim());
        saveData('文字已保存');
      });
      node.addEventListener('keydown', event => { if (event.key === 'Enter' && node.tagName !== 'SPAN') event.preventDefault(); });
    });
    document.querySelectorAll('[data-contact-toggle]').forEach(button => button.addEventListener('click', () => {
      const panel = document.querySelector('.contact-panel'); const arrow = document.querySelector('.contact-toggle'); const open = !panel.classList.contains('open'); panel.classList.toggle('open', open); arrow?.setAttribute('aria-expanded', String(open)); arrow && (arrow.textContent = open ? '↑' : '↗');
    }));
    document.querySelector('[data-copy-email]')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(data.profile.email); const button = document.querySelector('[data-copy-email] i'); if (button) { button.textContent = '已复制 ✓'; setTimeout(() => button.textContent = '复制', 2000); } showToast('邮箱已复制'); } catch { showToast(`邮箱：${data.profile.email}`); }
    });
    document.querySelectorAll('[data-upload-trigger]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); chooseUpload(button.dataset.uploadTrigger); }));
    document.querySelectorAll('[data-clear-image]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); set(button.dataset.clearImage, ''); render(); saveData('图片已清除'); }));
    document.querySelectorAll('[data-layout-path]').forEach(node => bindWindowAdjustment(node));
    bindAutoFitImages();
    bindBreakdownLightbox();
  }

  function bindAutoFitImages() {
    document.querySelectorAll('[data-auto-fit-image]').forEach(image => {
      const applyRatio = () => {
        if (!image.naturalWidth || !image.naturalHeight) return;
        image.closest('[data-auto-fit]')?.style.setProperty('--image-aspect', `${image.naturalWidth} / ${image.naturalHeight}`);
      };
      if (image.complete) applyRatio(); else image.addEventListener('load', applyRatio, { once:true });
    });
  }

  function closeLightbox() {
    lightboxCleanup?.();
    lightboxCleanup = null;
  }

  function bindBreakdownLightbox() {
    if (editing) return;
    document.querySelectorAll('.breakdown-zoomable').forEach(cell => {
      const open = () => openLightbox(cell.dataset.lightboxSrc, cell.dataset.lightboxAlt);
      cell.addEventListener('click', event => { if (!event.target.closest('.slot-editor')) open(); });
      cell.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
    });
  }

  function openLightbox(src, alt) {
    closeLightbox();
    const overlay = document.createElement('div');
    overlay.className = 'image-lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `放大查看 ${alt || '项目图片'}`);
    overlay.innerHTML = `<div class="lightbox-toolbar"><span>滚轮缩放 · 左键或中键拖动</span><output>100%</output><button type="button" data-lightbox-reset>重置</button><button type="button" data-lightbox-close aria-label="关闭图片预览">关闭 ×</button></div><div class="lightbox-stage"><img src="${esc(src)}" alt="${esc(alt || '项目图片')}"></div>`;
    document.body.append(overlay);
    document.body.classList.add('lightbox-open');

    const stage = overlay.querySelector('.lightbox-stage');
    const image = overlay.querySelector('img');
    const output = overlay.querySelector('output');
    const state = { scale:1, x:0, y:0, dragging:false, pointerId:null, startX:0, startY:0, originX:0, originY:0 };
    const update = () => { image.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`; output.textContent = `${Math.round(state.scale * 100)}%`; };
    const reset = () => { state.scale=1; state.x=0; state.y=0; update(); };
    const close = () => closeLightbox();
    const onKeydown = event => { if (event.key === 'Escape') close(); if (event.key === '0') reset(); };
    const previousOverflow = document.documentElement.style.overflow;

    stage.addEventListener('wheel', event => {
      event.preventDefault();
      const oldScale = state.scale;
      const nextScale = Math.min(6, Math.max(.5, oldScale * (event.deltaY < 0 ? 1.12 : .89)));
      const rect = stage.getBoundingClientRect();
      const px = event.clientX - rect.left - rect.width / 2;
      const py = event.clientY - rect.top - rect.height / 2;
      const ratio = nextScale / oldScale;
      state.x = px - (px - state.x) * ratio;
      state.y = py - (py - state.y) * ratio;
      state.scale = nextScale;
      update();
    }, { passive:false });
    image.addEventListener('pointerdown', event => {
      if (event.button !== 0 && event.button !== 1) return;
      event.preventDefault();
      state.dragging=true; state.pointerId=event.pointerId; state.startX=event.clientX; state.startY=event.clientY; state.originX=state.x; state.originY=state.y;
      image.classList.add('is-dragging');
      image.setPointerCapture?.(event.pointerId);
    });
    image.addEventListener('pointermove', event => {
      if (!state.dragging || event.pointerId !== state.pointerId) return;
      state.x = state.originX + event.clientX - state.startX;
      state.y = state.originY + event.clientY - state.startY;
      update();
    });
    const stopDrag = event => { if (!state.dragging || event.pointerId !== state.pointerId) return; state.dragging=false; state.pointerId=null; image.classList.remove('is-dragging'); };
    image.addEventListener('pointerup', stopDrag);
    image.addEventListener('pointercancel', stopDrag);
    overlay.addEventListener('click', event => { if (event.target === overlay || event.target === stage) close(); });
    overlay.querySelector('[data-lightbox-close]').addEventListener('click', close);
    overlay.querySelector('[data-lightbox-reset]').addEventListener('click', reset);
    document.addEventListener('keydown', onKeydown);
    document.documentElement.style.overflow = 'hidden';
    overlay.querySelector('[data-lightbox-close]').focus();

    lightboxCleanup = () => {
      document.removeEventListener('keydown', onKeydown);
      document.documentElement.style.overflow = previousOverflow;
      document.body.classList.remove('lightbox-open');
      overlay.remove();
    };
  }

  function bindMotion() {
    revealObserver?.disconnect();
    if (!data.theme.animationsEnabled || !('IntersectionObserver' in window)) {
      document.querySelectorAll('.motion-fade-up').forEach(node => node.classList.add('in-view'));
      return;
    }
    revealObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in-view');
      revealObserver.unobserve(entry.target);
    }), { threshold: 0.12 });
    document.querySelectorAll('.motion-fade-up').forEach(node => revealObserver.observe(node));
  }

  function bindWindowAdjustment(node) {
    const layoutPath = node.dataset.layoutPath;
    let active = null;
    const start = (event, mode) => {
      if (!editing || event.button !== 0) return;
      if (event.target.closest('button')) return;
      event.preventDefault(); event.stopPropagation();
      const current = get(layoutPath) || {};
      const rect = node.getBoundingClientRect();
      active = { mode, startX:event.clientX, startY:event.clientY, x:Number(current.x)||0, y:Number(current.y)||0, width:Math.round(rect.width), height:Math.round(rect.height) };
      node.classList.add('is-adjusting');
      node.setPointerCapture?.(event.pointerId);
    };
    node.addEventListener('pointerdown', event => start(event, event.target.closest('.resize-handle') ? 'resize' : 'drag'));
    node.addEventListener('pointermove', event => {
      if (!active) return;
      const dx = event.clientX - active.startX; const dy = event.clientY - active.startY;
      if (active.mode === 'drag') {
        node.style.setProperty('--media-x', `${Math.round(active.x + dx)}px`);
        node.style.setProperty('--media-y', `${Math.round(active.y + dy)}px`);
      } else {
        node.style.width = `${Math.max(180, Math.round(active.width + dx))}px`;
        node.style.height = `${Math.max(150, Math.round(active.height + dy))}px`;
        node.style.aspectRatio = 'auto';
      }
    });
    const finish = event => {
      if (!active) return;
      const dx = event.clientX - active.startX; const dy = event.clientY - active.startY;
      const previous = get(layoutPath) || {};
      const next = active.mode === 'drag'
        ? { ...previous, x:Math.round(active.x + dx), y:Math.round(active.y + dy) }
        : { ...previous, width:Math.max(180, Math.round(active.width + dx)), height:Math.max(150, Math.round(active.height + dy)) };
      set(layoutPath, next);
      node.classList.remove('is-adjusting'); active = null;
      saveData('展示窗口排版已保存');
    };
    node.addEventListener('pointerup', finish);
    node.addEventListener('pointercancel', finish);
  }

  function chooseUpload(path) {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/avif';
    input.addEventListener('change', async () => { const file = input.files?.[0]; if (!file) return; try { const result = await upload(file, '/api/upload', path); set(path, result.src); render(); saveData('图片已保存'); } catch (error) { showToast(error.message || '上传失败'); } }); input.click();
  }
  async function upload(file, endpoint, slot) {
    const response = await fetch(endpoint, { method:'POST', headers:{ 'content-type':file.type, 'x-file-name':encodeURIComponent(file.name), 'x-slot-id':idText(slot) }, body:file });
    const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || '上传失败'); return result;
  }

  async function saveData(successMessage = '') {
    try { const response = await fetch('/api/save-site', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(data) }); if (!response.ok) throw new Error(); if (successMessage) showToast(successMessage); setStatus('已保存到 ver0.1/site-data.json'); } catch { setStatus('保存失败：请确认 4174 编辑器服务仍在运行。', true); }
  }

  function renderBuilder() {
    document.querySelector('.builder-launch')?.remove(); document.querySelector('.builder-panel')?.remove();
    const launch = document.createElement('button'); launch.className = 'builder-launch'; launch.textContent = editing ? '完成编辑' : '编辑网站'; launch.addEventListener('click', () => { editing = !editing; render(); }); document.body.append(launch);
    if (!editing) return;
    const panel = document.createElement('aside'); panel.className = 'builder-panel';
    panel.innerHTML = `<div class="builder-head"><div><h2>页面编辑器</h2><p>点击页面文字可调整内容与字体样式。</p></div><button class="builder-close" aria-label="关闭编辑器">×</button></div><div class="builder-tabs"><button class="builder-tab ${activeTab==='theme'?'active':''}" data-tab="theme">视觉</button><button class="builder-tab ${activeTab==='text'?'active':''}" data-tab="text">文字样式</button><button class="builder-tab ${activeTab==='structure'?'active':''}" data-tab="structure">页面结构</button><button class="builder-tab ${activeTab==='projects'?'active':''}" data-tab="projects">作品项目</button></div>${builderPage()}<p class="builder-status"></p>`;
    panel.querySelector('.builder-close').addEventListener('click', () => { editing = false; render(); });
    panel.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => { activeTab=button.dataset.tab; renderBuilder(); }));
    bindBuilder(panel);
    document.body.append(panel);
  }

  function builderPage() {
    if (activeTab === 'theme') return `<div class="builder-page active"><div class="control-group"><label>背景色 <input data-theme="background" type="color" value="${data.theme.background}"></label><label>文字色 <input data-theme="text" type="color" value="${data.theme.text}"></label><label>强调色 <input data-theme="accent" type="color" value="${data.theme.accent}"></label><label>信息文字色 <input data-theme="muted" type="color" value="${data.theme.muted}"></label></div><div class="control-group"><label>全站默认字体 <input data-theme="font" type="text" list="local-font-list" value="${esc(data.theme.font)}"></label>${fontDatalist()}<button class="builder-button" data-load-fonts>读取本机已安装字体</button><p class="tiny">4174 本地编辑服务会读取 Windows 已安装字体的名称，不会复制或上传字体文件。没有安装所选字体的电脑会自动使用默认字体。</p><label>基础间距 <input data-theme="baseSpacing" type="number" min="8" max="80" value="${data.theme.baseSpacing}"></label><label>动画时长（毫秒）<input data-theme="animationDuration" type="number" min="0" max="2000" step="10" value="${data.theme.animationDuration}"></label><label>启用入场动画 <input data-theme="animationsEnabled" type="checkbox" ${data.theme.animationsEnabled?'checked':''}></label></div></div>`;
    if (activeTab === 'text') {
      if (!selectedTextKey) return `<div class="builder-page active"><div class="text-empty"><strong>先在页面中点击一段文字</strong><p>可选择标题、正文、按钮、栏目编号、项目标签或页脚文字。</p></div><div class="control-group"><button class="builder-button" data-load-fonts>读取本机已安装字体</button><p class="tiny">只读取 Windows 字体名称，不会复制或上传字体文件。</p></div></div>`;
      return `<div class="builder-page active"><div class="text-selection"><span>当前文字</span><strong>${esc(selectedTextLabel || '已选文字')}</strong></div><div class="control-group"><label>字体 <input data-text-style="fontFamily" type="text" list="local-font-list" value="${esc(textStyleValue('fontFamily'))}"></label>${fontDatalist()}<button class="builder-button" data-load-fonts>读取本机已安装字体</button><label>字号 <span class="unit-input"><input data-text-style="fontSize" type="number" min="6" max="300" step="1" value="${esc(textStyleValue('fontSize', 16))}"><i>px</i></span></label><label>颜色 <input data-text-style="color" type="color" value="${esc(textStyleValue('color', '#f0eee8'))}"></label><label>字重 <select data-text-style="fontWeight">${['100','200','300','400','500','600','700','800','900'].map(value => `<option value="${value}" ${String(textStyleValue('fontWeight','400'))===value?'selected':''}>${value}</option>`).join('')}</select></label><label>字形 <select data-text-style="fontStyle"><option value="normal" ${textStyleValue('fontStyle','normal')==='normal'?'selected':''}>常规</option><option value="italic" ${textStyleValue('fontStyle')==='italic'?'selected':''}>斜体</option></select></label><label>装饰 <select data-text-style="textDecoration"><option value="none" ${textStyleValue('textDecoration','none')==='none'?'selected':''}>无</option><option value="underline" ${textStyleValue('textDecoration')==='underline'?'selected':''}>下划线</option><option value="line-through" ${textStyleValue('textDecoration')==='line-through'?'selected':''}>删除线</option></select></label><label>字间距 <span class="unit-input"><input data-text-style="letterSpacing" type="number" min="-10" max="30" step="0.1" value="${esc(textStyleValue('letterSpacing',0))}"><i>px</i></span></label><label>行高 <input data-text-style="lineHeight" type="number" min="0.7" max="3" step="0.05" value="${esc(textStyleValue('lineHeight',1.2))}"></label><button class="builder-button" data-reset-text-style>恢复这段文字的默认样式</button></div><p class="tiny">修改会保存到 site-data.json；同一段文字的内容仍可直接在页面中编辑。</p></div>`;
    }
    if (activeTab === 'structure') {
      const rows = orderedBlocks().map((item, i) => `<div class="list-row"><span class="${selectedSection===item.id?'selected':''}">${esc(item.id)} · ${esc(item.type)}</span><button data-section-select="${item.id}">设置</button><button data-section-move="${i}|-1">↑</button><button data-section-move="${i}|1">↓</button></div>`).join('');
      const selected = block(selectedSection) || data.sections[0];
      const canDelete = Boolean(customSection(selected.id));
      return `<div class="builder-page active"><div class="control-group"><strong>页面区块（${orderedBlocks().length} 个）</strong>${rows}</div><div class="control-group"><label>显示这个区块 <input data-section-field="enabled" type="checkbox" ${selected.enabled?'checked':''}></label><label>上、下留白 <input data-section-field="padding" type="number" min="30" max="240" value="${selected.padding}"></label><label>布局 <select data-section-field="layout"><option value="mixed" ${selected.layout==='mixed'?'selected':''}>作品：首项大图</option><option value="single" ${selected.layout==='single'?'selected':''}>作品：等宽竖排</option><option value="grid" ${selected.layout==='grid'?'selected':''}>作品：双列网格</option><option value="horizontal" ${selected.layout==='horizontal'?'selected':''}>拆解：内部横向</option><option value="split" ${selected.layout==='split'?'selected':''}>首屏：左右结构</option><option value="two-column" ${selected.layout==='two-column'?'selected':''}>介绍：双栏</option><option value="stacked" ${selected.layout==='stacked'?'selected':''}>联系：竖向</option><option value="custom" ${selected.layout==='custom'?'selected':''}>自定义</option></select></label><label>入场动画 <select data-section-field="animation"><option value="fade-up" ${selected.animation==='fade-up'?'selected':''}>向上淡入</option><option value="none" ${selected.animation==='none'?'selected':''}>无</option></select></label>${canDelete?'<button class="builder-button danger" data-remove-custom="'+esc(selected.id)+'">删除这个自定义区块</button>':''}</div><div class="control-group"><strong>添加自定义区块</strong><button class="builder-button" data-add-custom="text">+ 文字区块</button><button class="builder-button" data-add-custom="gallery">+ 图片画廊</button><p class="tiny">自定义区块可作为技术研究、获奖信息、练习合集等内容。</p></div></div>`;
    }
    const rows = data.works.map((work, i) => `<div class="list-row"><span class="${selectedWork===work.id?'selected':''}">0${i+1} · ${esc(work.title)}</span><button data-work-select="${work.id}">编辑</button><button data-work-move="${i}|-1">↑</button><button data-work-move="${i}|1">↓</button></div>`).join('');
    const work = data.works.find(item => item.id === selectedWork) || data.works[0];
    return `<div class="builder-page active"><div class="control-group"><strong>精选作品（${data.works.length} 项）</strong>${rows}<button class="builder-button accent" data-add-work>+ 添加作品</button></div><div class="control-group"><label>项目辅助色 <input data-work-color type="color" value="${projectColor(work.accent)}"></label><label>显示当前项目拆解 <input data-work-setting="breakdownEnabled" type="checkbox" ${work.breakdownEnabled !== false ? 'checked' : ''}></label><label>隐藏没有图片的拆解槽位 <input data-work-setting="hideEmptyBreakdownMedia" type="checkbox" ${work.hideEmptyBreakdownMedia ? 'checked' : ''}></label><button class="builder-button danger" data-remove-work="${work.id}">删除当前作品</button><p class="tiny">作品默认同步生成项目拆解；也可以只保留精选作品卡片，或隐藏尚未上传图片的拆解槽位。阶段标签可在页面中直接编辑。</p></div><div class="control-group"><strong>当前项目拆解图（${work.media.length} 项）</strong>${work.media.map((medium, i) => `<div class="list-row"><span>${esc(medium.label)} · ${esc(medium.title)}</span><button data-upload-trigger="works.${workIndex(work.id)}.media.${i}.src">上传</button><button data-media-move="${i}|-1">↑</button><button data-media-move="${i}|1">↓</button></div>`).join('')}<button class="builder-button" data-add-media="${work.id}">+ 添加拆解展示</button></div></div>`;
  }

  function bindBuilder(panel) {
    panel.querySelectorAll('[data-theme]').forEach(input => input.addEventListener('input', () => { const key=input.dataset.theme; data.theme[key]=input.type==='checkbox'?input.checked:(input.type==='number'?Number(input.value):input.value); applyTheme(); saveData(); }));
    panel.querySelector('[data-load-fonts]')?.addEventListener('click', loadLocalFonts);
    panel.querySelectorAll('[data-text-style]').forEach(input => input.addEventListener('input', () => {
      if (!selectedTextKey) return;
      const key = input.dataset.textStyle;
      const numberKeys = new Set(['fontSize', 'letterSpacing', 'lineHeight']);
      data.textStyles ||= {};
      data.textStyles[selectedTextKey] ||= {};
      data.textStyles[selectedTextKey][key] = numberKeys.has(key) ? Number(input.value) : input.value;
      canvas.querySelectorAll('[data-text-style-key]').forEach(node => {
        if (node.dataset.textStyleKey === selectedTextKey) applyTextStyle(node, data.textStyles[selectedTextKey]);
      });
      saveData();
    }));
    panel.querySelector('[data-reset-text-style]')?.addEventListener('click', () => {
      if (!selectedTextKey) return;
      delete data.textStyles[selectedTextKey];
      selectedTextDefaults = null;
      render();
      const selected = [...canvas.querySelectorAll('[data-text-style-key]')].find(node => node.dataset.textStyleKey === selectedTextKey);
      if (selected) {
        selectedTextDefaults = currentTextDefaults(selected);
        selectedTextLabel = selected.dataset.textLabel || directText(selected);
        renderBuilder();
      }
      saveData('文字样式已恢复');
    });
    panel.querySelectorAll('[data-section-select]').forEach(button => button.addEventListener('click', () => { selectedSection=button.dataset.sectionSelect; renderBuilder(); }));
    panel.querySelectorAll('[data-section-field]').forEach(input => input.addEventListener('input', () => { const item=block(selectedSection); item[input.dataset.sectionField]=input.type==='checkbox'?input.checked:(input.type==='number'?Number(input.value):input.value); render(); saveData(); }));
    panel.querySelectorAll('[data-section-move]').forEach(button => button.addEventListener('click', () => move(data.pageOrder, button.dataset.sectionMove, () => { render(); saveData('区块顺序已保存'); })));
    panel.querySelectorAll('[data-add-custom]').forEach(button => button.addEventListener('click', () => { const gallery=button.dataset.addCustom==='gallery'; const id=`custom-${Date.now()}`; data.customSections.push({id,type:gallery?'gallery':'text',enabled:true,animation:'fade-up',padding:100,layout:'custom',title:gallery?'图片画廊':'自定义文字区块',content:gallery?'可用于补充练习、技术研究或小项目。':'点击这段文字直接编辑。',columns:3,items:gallery?[{title:'展示一',src:''},{title:'展示二',src:''},{title:'展示三',src:''}]:[]}); data.pageOrder.push(id); selectedSection=id; render(); saveData('已添加自定义区块'); }));
    panel.querySelector('[data-remove-custom]')?.addEventListener('click', () => { const id=panel.querySelector('[data-remove-custom]').dataset.removeCustom; data.customSections=data.customSections.filter(item=>item.id!==id); data.pageOrder=data.pageOrder.filter(item=>item!==id); selectedSection='hero'; render(); saveData('自定义区块已删除'); });
    panel.querySelectorAll('[data-work-select]').forEach(button => button.addEventListener('click', () => { selectedWork=button.dataset.workSelect; renderBuilder(); }));
    panel.querySelectorAll('[data-work-setting]').forEach(input => input.addEventListener('input', () => { const work=data.works.find(item=>item.id===selectedWork); work[input.dataset.workSetting]=input.checked; render(); saveData('项目拆解设置已保存'); }));
    panel.querySelector('[data-work-color]')?.addEventListener('input', input => { const work=data.works.find(item=>item.id===selectedWork); work.accent=input.target.value; render(); saveData(); });
    panel.querySelectorAll('[data-work-move]').forEach(button => button.addEventListener('click', () => move(data.works, button.dataset.workMove, () => { render(); saveData('作品顺序已保存'); })));
    panel.querySelector('[data-add-work]')?.addEventListener('click', addWork);
    panel.querySelector('[data-remove-work]')?.addEventListener('click', () => { if (data.works.length === 1) return showToast('至少保留一个作品项目'); const id=panel.querySelector('[data-remove-work]').dataset.removeWork; data.works.splice(workIndex(id),1); selectedWork=data.works[0].id; render(); saveData('作品已删除'); });
    panel.querySelectorAll('[data-media-move]').forEach(button => button.addEventListener('click', () => { const work=data.works.find(item=>item.id===selectedWork); move(work.media, button.dataset.mediaMove, () => { render(); saveData('拆解展示顺序已保存'); }); }));
    panel.querySelector('[data-add-media]')?.addEventListener('click', () => { const work=data.works.find(item=>item.id===selectedWork); work.media.push({id:`media-${Date.now()}`,label:'DETAIL',title:'新的拆解展示',hint:'点击上传图片',src:'',fit:'contain'}); render(); saveData('已添加拆解展示'); });
    panel.querySelectorAll('[data-upload-trigger]').forEach(button => button.addEventListener('click', () => chooseUpload(button.dataset.uploadTrigger)));
  }

  function move(list, token, done) { const [raw, rawShift] = token.split('|'); const index=Number(raw); const target=index+Number(rawShift); if (target < 0 || target >= list.length) return; [list[index], list[target]]=[list[target], list[index]]; done(); }
  function addWork() {
    const serial=String(data.works.length+1).padStart(2,'0'); const id=`work-${serial}`;
    data.works.push({id,breakdownEnabled:true,hideEmptyBreakdownMedia:false,accent:'#aa5844',stages:['MODELING','RETOPO','UV','TEXTURE','NPR','UNITY'],type:'NEW CHARACTER PROJECT',title:'新角色项目',year:'2027',tags:['Maya','Substance Painter','Unity'],cover:{src:'',alt:'新作品封面',fit:'contain'},media:[{id:'final',label:'FINAL RENDER',title:'最终效果',hint:'点击上传最终渲染图',src:'',fit:'contain'},{id:'sculpt',label:'SCULPT',title:'高模雕刻',hint:'点击上传高模图',src:'',fit:'contain'},{id:'wireframe',label:'WIREFRAME',title:'拓扑与线框',hint:'点击上传线框图',src:'',fit:'contain'}],facts:[['职责','角色全流程制作'],['周期','约 X 周'],['面数','XX,XXX Tris'],['贴图','4K PBR × X'],['引擎','Unity'],['个人完成','全部由个人独立完成']]}); selectedWork=id; render(); saveData('新作品已添加');
  }
  function setStatus(message, isError=false) { const el=document.querySelector('.builder-status'); if (el) { el.textContent=message; el.classList.toggle('error',isError); } }

  fetch('./site-data.json', {cache:'no-store'}).then(response => { if (!response.ok) throw new Error('无法读取 site-data.json'); return response.json(); }).then(json => { data=json; render(); }).catch(error => { canvas.innerHTML=`<section class="site-section"><h1>无法加载作品集</h1><p>${esc(error.message)}</p></section>`; });
})();
