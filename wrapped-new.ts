// NEW WRAPPED IMPLEMENTATION - Simple but working

export function generateWrapped(service: any): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d')!;

  // Get data
  const works = service.getWorks();
  const activeWorks = works.filter((w: any) => ['COMPLETED', 'CURRENT'].includes(w.status));
  const completedWorks = works.filter((w: any) => w.status === 'COMPLETED');

  const anime = activeWorks.filter((w: any) => w.type === 'anime');
  const manga = activeWorks.filter((w: any) => w.type === 'manga');
  const completedAnime = completedWorks.filter((w: any) => w.type === 'anime');
  const completedManga = completedWorks.filter((w: any) => w.type === 'manga');

  const stats = {
    animeCount: anime.length,
    mangaCount: manga.length,
    totalEpisodes: completedAnime.reduce((acc: number, w: any) => acc + (w.episodes || 0), 0),
    totalChapters: completedManga.reduce((acc: number, w: any) => acc + (w.chapters || 0), 0),
    animeDays: completedAnime.reduce((acc: number, w: any) => acc + ((w.episodes || 0) * (w.duration || 24)), 0) / (60 * 24),
    completed: completedWorks.length,
    watching: works.filter((w: any) => w.status === 'CURRENT').length,
    planning: works.filter((w: any) => w.status === 'PLANNING').length,
    dropped: works.filter((w: any) => w.status === 'DROPPED').length,
    paused: works.filter((w: any) => w.status === 'PAUSED').length,
    rewatching: works.filter((w: any) => w.status === 'REPEATING').length,
  };

  // Calculate means
  const animeScores = anime.map((w: any) => service.calcSeriesOverall(w)).filter((s: number | null) => s !== null && s > 0);
  const mangaScores = manga.map((w: any) => service.calcSeriesOverall(w)).filter((s: number | null) => s !== null && s > 0);
  const allScores = [...animeScores, ...mangaScores];

  stats.animeMean = animeScores.length ? animeScores.reduce((a: number, b: number) => a + b, 0) / animeScores.length * 10 : 0;
  stats.mangaMean = mangaScores.length ? mangaScores.reduce((a: number, b: number) => a + b, 0) / mangaScores.length * 10 : 0;
  stats.overallMean = allScores.length ? allScores.reduce((a: number, b: number) => a + b, 0) / allScores.length * 10 : 0;

  // Monthly data
  const monthlyData = new Array(12).fill(0);
  activeWorks.forEach((w: any) => {
    const month = new Date(w.updatedAt).getMonth();
    monthlyData[month]++;
  });

  const mostActiveMonthIndex = monthlyData.indexOf(Math.max(...monthlyData));
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Genres
  const genreMap: Record<string, number> = {};
  activeWorks.forEach((w: any) => (w.genres || []).forEach((g: string) => genreMap[g] = (genreMap[g] || 0) + 1));
  const topGenres = Object.entries(genreMap).sort((a, b) => b[1] - a[1]).slice(0, 6);

  // ============ DRAW ============

  // Background
  const bg = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  bg.addColorStop(0, '#0a0e27');
  bg.addColorStop(0.5, '#1a1b4b');
  bg.addColorStop(1, '#0f0a1e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Liquid blobs
  const blobs = [
    { x: 400, y: 300, r: 600, color: 'rgba(59, 130, 246, 0.15)' },
    { x: 1500, y: 200, r: 500, color: 'rgba(139, 92, 246, 0.12)' },
    { x: 960, y: 700, r: 550, color: 'rgba(6, 182, 212, 0.1)' },
  ];

  blobs.forEach(blob => {
    const grad = ctx.createRadialGradient(blob.x, blob.y, 0, blob.x, blob.y, blob.r);
    grad.addColorStop(0, blob.color);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  });

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 70px Arial';
  ctx.fillText('YOUR 2024 WRAPPED', 70, 90);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.font = 'bold 22px Arial';
  ctx.fillText('Your Ultimate Anime & Manga Year in Review', 70, 125);

  // Helper function
  function drawCard(x: number, y: number, w: number, h: number, title: string, value: string, subtitle: string, color: string) {
    // Box
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    // Accent line
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, 4);

    // Title
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = 'bold 18px Arial';
    ctx.fillText(title, x + 25, y + 45);

    // Value
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 60px Arial';
    ctx.fillText(value, x + 25, y + 115);

    // Subtitle
    ctx.fillStyle = color;
    ctx.font = 'bold 16px Arial';
    ctx.fillText(subtitle, x + 25, y + 145);
  }

  // Main cards
  drawCard(70, 170, 560, 170, '📺 ANIME', stats.animeCount.toString(),
    `${stats.totalEpisodes} eps • ${stats.animeDays.toFixed(1)} days • ${stats.animeMean.toFixed(1)}`, '#3b82f6');

  drawCard(660, 170, 560, 170, '📖 MANGA', stats.mangaCount.toString(),
    `${stats.totalChapters} chapters • ${stats.mangaMean.toFixed(1)}`, '#ec4899');

  drawCard(1250, 170, 600, 170, '📅 ACTIVITY', (activeWorks.length).toString(),
    `Most active: ${monthNames[mostActiveMonthIndex]} • ${stats.overallMean.toFixed(1)} mean`, '#8b5cf6');

  // Small cards helper
  function drawSmall(x: number, y: number, w: number, h: number, label: string, value: string, color: string) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = color;
    ctx.fillRect(x, y, 4, h);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = 'bold 14px Arial';
    ctx.fillText(label, x + 20, y + 30);

    ctx.fillStyle = color;
    ctx.font = 'bold 42px Arial';
    ctx.fillText(value, x + 20, y + 80);
  }

  // Status row 1
  const y2 = 370;
  const cw = 270;
  const gap = 20;
  drawSmall(70, y2, cw, 110, 'COMPLETED', stats.completed.toString(), '#10b981');
  drawSmall(70 + cw + gap, y2, cw, 110, 'WATCHING', stats.watching.toString(), '#3b82f6');
  drawSmall(70 + (cw + gap) * 2, y2, cw, 110, 'PLANNING', stats.planning.toString(), '#f59e0b');
  drawSmall(70 + (cw + gap) * 3, y2, cw, 110, 'DROPPED', stats.dropped.toString(), '#ef4444');

  // Status row 2
  const y3 = y2 + 130;
  drawSmall(70, y3, cw, 110, 'PAUSED', stats.paused.toString(), '#6366f1');
  drawSmall(70 + cw + gap, y3, cw, 110, 'REWATCHING', stats.rewatching.toString(), '#06b6d4');
  drawSmall(70 + (cw + gap) * 2, y3, cw, 110, 'MEAN SCORE', stats.overallMean.toFixed(1), '#ffffff');
  drawSmall(70 + (cw + gap) * 3, y3, cw, 110, 'TOTAL', activeWorks.length.toString(), '#a855f7');

  // Genres box
  const y4 = y3 + 150;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.fillRect(70, y4, 580, 150);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.strokeRect(70, y4, 580, 150);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px Arial';
  ctx.fillText('🎭 TOP GENRES', 90, y4 + 35);

  const colors = ['#3b82f6', '#ec4899', '#8b5cf6', '#10b981', '#f59e0b', '#06b6d4'];
  topGenres.forEach(([genre, count], i) => {
    const row = Math.floor(i / 2);
    const col = i % 2;
    const gx = 90 + col * 280;
    const gy = y4 + 70 + row * 35;

    ctx.fillStyle = colors[i];
    ctx.font = 'bold 16px Arial';
    ctx.fillText(genre, gx, gy);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillText(count.toString(), gx + 220, gy);
  });

  // Monthly chart
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.fillRect(670, y4, 1180, 150);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.strokeRect(670, y4, 1180, 150);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px Arial';
  ctx.fillText('📈 MONTHLY ACTIVITY', 690, y4 + 35);

  const chartX = 690;
  const chartY = y4 + 50;
  const chartW = 1140;
  const chartH = 85;
  const max = Math.max(...monthlyData, 1);
  const barW = chartW / 12;
  const months = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

  monthlyData.forEach((value, i) => {
    const barH = Math.max((value / max) * chartH, 2);
    const barX = chartX + i * barW;
    const barY = chartY + chartH - barH;

    const grad = ctx.createLinearGradient(barX, barY, barX, barY + barH);
    grad.addColorStop(0, '#3b82f6');
    grad.addColorStop(1, '#ec4899');
    ctx.fillStyle = grad;
    ctx.fillRect(barX + 5, barY, barW - 10, barH);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(months[i], barX + barW / 2, chartY + chartH + 15);
  });

  ctx.textAlign = 'left';

  // Footer
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.font = 'bold 16px Arial';
  ctx.textAlign = 'right';
  ctx.fillText('Generated by AniList Ultimate', canvas.width - 70, canvas.height - 40);
  ctx.textAlign = 'left';

  return canvas;
}
