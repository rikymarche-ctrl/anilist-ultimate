/**
 * Anime Card Component
 * Displays individual anime entry with cover, title, episode info
 */

import { BaseComponent } from '@ui/components/BaseComponent';
import { calendarStore } from '../CalendarStore';
import { calendarService } from '../CalendarService';
import { anilistClient } from '../../../api';
import { SocialRenderer } from '../../social/SocialRenderer';
import type { AnimeEntry, CardOptions } from '@core/types';

interface AnimeCardProps {
  anime: AnimeEntry;
  options: CardOptions;
}

export class AnimeCard extends BaseComponent<AnimeCardProps> {
  protected render(): HTMLElement {
    const { anime, options } = this.props;
    const { layoutMode, fullWidthImages, titleAlignment } = options;

    const classList = [`anime-card`, `anime-card--${layoutMode}`];

    // Apply full width images class
    if (fullWidthImages) {
      classList.push('anime-card--full-width-images');
    }

    // Apply title alignment class
    if (titleAlignment === 'center') {
      classList.push('anime-card--title-center');
    }

    const card = this.createElement('div', {
      class: classList.join(' '),
    });

    card.setAttribute('data-media-id', anime.mediaId.toString());

    // Build card HTML
    card.innerHTML = this.getCardHTML(anime, options);

    // Add status classes
    if (calendarService.hasAired(anime)) {
      card.classList.add('anime-card--aired');
    } else if (calendarService.isAiringSoon(anime)) {
      card.classList.add('anime-card--airing-soon');
    }

    // Add behind class — the red dot is rendered inside the episode text in getCardHTML
    const episodesBehind = Math.max(0, anime.episode - 1 - anime.progress);
    if (episodesBehind > 0) {
      card.classList.add('anime-card--is-behind');
    }

    return card;
  }

  private getCardHTML(anime: AnimeEntry, options: CardOptions): string {
    const { layoutMode, showTime, showEpisodeNumbers, timeFormat } = options;
    const { socialEnabled, socialShowAvatars } = calendarStore.getState().preferences;

    const showPillSocial = socialEnabled && !socialShowAvatars;
    const showFloatingSocial = socialEnabled && socialShowAvatars;

    const socialSectionHTML = showPillSocial ? `
      <div class="pill-separator"></div>
      <div class="pill-section" data-action="social-activity">
        <i class="fa fa-users"></i>
      </div>
    ` : '';

    // Episode counter: "watched/available/total" (matches old version exactly)
    const available = anime.episode - 1; 
    const watched = anime.progress;
    const total = anime.totalEpisodes;
    const episodesBehind = Math.max(0, available - watched);
    const isBehind = episodesBehind > 0;

    let episodeStr = "";
    if (isBehind) {
      episodeStr = total ? `${watched}/${available}/${total}` : `${watched}/${available}`;
    } else {
      // Caught up
      if (total && total > 1) {
        episodeStr = `${watched}/${total}`;
      } else if (total === 1 && watched === 1) {
        episodeStr = "1";
      } else {
        episodeStr = `${watched}`;
      }
    }

    // Red dot indicator (prepended), only when behind (no native title)
    const behindDotHTML = isBehind
      ? `<span class="behind-indicator"></span>`
      : '';

    // Common elements
    const titleHTML = `
      <h3 class="anime-card__title">${anime.cleanTitle}</h3>
    `;

    const episodeHTML = showEpisodeNumbers
      ? `<span class="anime-card__episode">${behindDotHTML}Ep ${episodeStr}</span>`
      : '';

    const timeHTML = showTime ? this.getTimeHTML(anime, timeFormat) : '';

    // Layout-specific structure
    if (layoutMode === 'compact') {
      // Compact mode: MINIMAL - Only text, NO images
      const actionPillHTML = `
        <div class="action-pill action-pill--compact">
          <div class="pill-section" data-action="mark-watched">
            <i class="fa fa-plus"></i>
          </div>
          <div class="pill-separator"></div>
          <div class="pill-section" data-action="edit-entry">
            <i class="fa fa-pencil"></i>
          </div>
          ${socialSectionHTML}
        </div>
      `;

      return `
        <div class="anime-card__compact-content">
          ${titleHTML}
          <div class="anime-card__meta">
            ${episodeHTML}
            ${timeHTML}
          </div>
        </div>
        <div class="anime-card__action anime-card__action--compact">
          ${actionPillHTML}
        </div>
      `;
    }

    if (layoutMode === 'extended') {
      // Extended mode: Vertical card with full-width cover (v2's old standard)
      const coverHTML = `
        <div class="anime-card__cover">
          <img
            src="${anime.coverImage}"
            alt="${anime.cleanTitle}"
            loading="lazy"
            class="anime-card__image"
          />
        </div>
      `;

      const actionPillHTML = `
        <div class="action-pill">
          <div class="pill-section" data-action="mark-watched">
            <i class="fa fa-plus"></i>
          </div>
          <div class="pill-separator"></div>
          <div class="pill-section" data-action="edit-entry">
            <i class="fa fa-pencil"></i>
          </div>
          ${socialSectionHTML}
        </div>
      `;

      return `
        <div class="anime-card__extended-layout">
          ${coverHTML}
          <div class="anime-card__content">
            ${titleHTML}
            <div class="anime-card__details">
              <div class="anime-card__meta-row">
                ${episodeHTML}
                ${timeHTML}
              </div>
            </div>
          </div>
          <div class="anime-card__action anime-card__action--extended">
            ${actionPillHTML}
          </div>
        </div>
      `;
    }

    // Standard layout: action pill is a SIBLING of image-container (not inside),
    // so it is not clipped by the image-container's overflow:hidden.
    // It stays within the card bounds and is positioned over the image area.
    const standardActionHTML = `
      <div class="anime-card__action anime-card__action--standard">
        <div class="action-pill">
          <div class="pill-section" data-action="mark-watched">
            <i class="fa fa-plus"></i>
          </div>
          <div class="pill-separator"></div>
          <div class="pill-section" data-action="edit-entry">
            <i class="fa fa-pencil"></i>
          </div>
          ${socialSectionHTML}
        </div>
      </div>
    `;

    const cardContentHTML = `
      <div class="anime-card__image-container">
        <img
          src="${anime.coverImage}"
          alt="${anime.cleanTitle}"
          loading="lazy"
          class="anime-card__image"
        />
        <div class="anime-card__image-overlay"></div>
      </div>
      <div class="anime-card__content">
        ${titleHTML}
        <div class="anime-card__meta">
          ${episodeHTML}
          ${timeHTML}
        </div>
      </div>
      ${standardActionHTML}
    `;

    return `
      <div class="anime-card__container">
        ${cardContentHTML}
      </div>
      ${showFloatingSocial ? `
        <div class="au-social-wrapper" id="friends-${anime.mediaId}">
          ${SocialRenderer.getAvatarsHTML(anime.friendActivity || [])}
          ${SocialRenderer.getSocialButtonHTML()}
        </div>
      ` : ''}
    `;
  }

  private getTimeHTML(anime: AnimeEntry, timeFormat: 'release' | 'countdown'): string {
    let timeText: string;

    if (timeFormat === 'countdown') {
      timeText = calendarService.formatTimeUntilAiring(anime.timeUntilAiring);
    } else {
      timeText = calendarService.formatAiringTime(anime.airingAt);
    }

    return `<span class="anime-card__time">${timeText}</span>`;
  }

  protected attachEvents(): void {
    // Card click - navigate to anime page (but NOT when clicking specific buttons)
    this.addEventListener(this.element, 'click', (e) => {
      const target = e.target as HTMLElement;

      // Only block if we clicked specifically on a button (pill-section)
      // Otherwise, we want the glass overlay to be clickable for navigation
      if (target.closest('[data-action]')) {
        return;
      }

      // Check preference for opening tab
      const openInNewTab = this.props.options.openInNewTab;
      const windowTarget = openInNewTab ? '_blank' : '_self';
      
      window.open(this.props.anime.siteUrl, windowTarget);
    });

    // Action button click
    const markWatchedBtn = this.element.querySelector('[data-action="mark-watched"]');
    if (markWatchedBtn) {
      this.addEventListener(markWatchedBtn as HTMLElement, 'click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.handleMarkWatched();
      });
    }

    // Edit button click
    const editBtn = this.element.querySelector('[data-action="edit-entry"]');
    if (editBtn) {
      this.addEventListener(editBtn as HTMLElement, 'click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.handleEditEntry();
      });
    }

    // Social activity button click
    const socialBtn = this.element.querySelector('[data-action="social-activity"]');
    if (socialBtn) {
      this.addEventListener(socialBtn as HTMLElement, 'click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.handleSocialActivity();
      });
    }

    // Tooltips for action buttons
    if (markWatchedBtn) {
      const lastAired = this.props.anime.episode - 1;
      this.addEventListener(markWatchedBtn as HTMLElement, 'mouseenter', (e) => {
        const episodesBehind = Math.max(0, lastAired - this.props.anime.progress);
        if (episodesBehind > 0) {
          const remaining = episodesBehind - 1;
          const text = remaining <= 0 ? "You'll be caught up!" : 
                       (remaining === 1 ? '1 episode will remain' : `${remaining} episodes will remain`);
          this.showCardTooltip(text, e);
        } else {
          const nextEp = this.props.anime.episode;
          this.showCardTooltip(`Mark episode ${nextEp} as watched`, e);
        }
      });
      this.addEventListener(markWatchedBtn as HTMLElement, 'mousemove', (e) => {
        this.moveCardTooltip(e);
      });
      this.addEventListener(markWatchedBtn as HTMLElement, 'mouseleave', () => {
        this.hideCardTooltip();
      });
    }

    if (editBtn) {
      this.addEventListener(editBtn as HTMLElement, 'mouseenter', (e) => {
        this.showCardTooltip('Quick edit', e);
      });
      this.addEventListener(editBtn as HTMLElement, 'mousemove', (e) => {
        this.moveCardTooltip(e);
      });
      this.addEventListener(editBtn as HTMLElement, 'mouseleave', () => {
        this.hideCardTooltip();
      });
    }

    if (socialBtn) {
      this.addEventListener(socialBtn as HTMLElement, 'mouseenter', (e) => {
        this.showCardTooltip('Social Activity', e);
      });
      this.addEventListener(socialBtn as HTMLElement, 'mousemove', (e) => {
        this.moveCardTooltip(e);
      });
      this.addEventListener(socialBtn as HTMLElement, 'mouseleave', () => {
        this.hideCardTooltip();
      });
    }
  }

  private handleSocialActivity(): void {
    const { anime } = this.props;
    // Emit custom event for SocialSidebar to handle
    window.dispatchEvent(new CustomEvent('au-open-social-sidebar', {
        detail: { mediaId: anime.mediaId, title: anime.cleanTitle, element: this.element }
    }));
  }

  private handleEditEntry(): void {
    const { anime } = this.props;
    // Open (or create) the inline list editor modal
    this.openListEditorModal(anime.mediaId);
  }

  private openListEditorModal(mediaId: number): void {
    // Re-use existing modal if already in DOM
    let overlay = document.getElementById('au-v2-list-editor-overlay') as HTMLElement | null;

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'au-v2-list-editor-overlay';
      overlay.className = 'au-v2-editor-overlay';
      overlay.innerHTML = `
        <div class="au-v2-editor-modal">
          <div class="au-v2-editor-header">
            <h2 class="au-v2-editor-title">Edit Entry</h2>
            <button class="au-v2-editor-close"><i class="fa fa-times"></i></button>
          </div>
          <div class="au-v2-editor-body">
            <div class="au-v2-loading"><i class="fa fa-spinner fa-spin"></i> Loading...</div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.querySelector('.au-v2-editor-close')!.addEventListener('click', () => {
        overlay!.classList.remove('au-v2-editor--open');
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay!.classList.remove('au-v2-editor--open');
      });
    }

    // Show modal immediately with spinner
    const body = overlay.querySelector('.au-v2-editor-body') as HTMLElement;
    const title = overlay.querySelector('.au-v2-editor-title') as HTMLElement;
    body.innerHTML = `<div class="au-v2-loading"><i class="fa fa-spinner fa-spin"></i> Fetching data...</div>`;
    overlay.classList.add('au-v2-editor--open');

    // Fetch current entry data
    const GQL_MEDIA = `query($id: Int) {
      Media(id: $id) {
        id title { userPreferred } episodes coverImage { large }
        mediaListEntry {
          id status score(format: POINT_100) progress notes private
          startedAt { year month day } completedAt { year month day }
        }
      }
    }`;
    const GQL_SAVE = `mutation($mediaId:Int,$status:MediaListStatus,$score:Float,$progress:Int,$notes:String,$private:Boolean) {
      SaveMediaListEntry(mediaId:$mediaId,status:$status,score:$score,progress:$progress,notes:$notes,private:$private) {
        id status score progress
      }
    }`;

    anilistClient.query<any>(GQL_MEDIA, { id: mediaId }).then((data: any) => {
      const media = data?.Media;
      if (!media) {
        body.innerHTML = `<p style="color:#ff4f4f;padding:20px">Could not load entry. Are you logged in?</p>`;
        return;
      }
      const e = media.mediaListEntry || {};
      title.textContent = media.title?.userPreferred ?? 'Edit Entry';
      body.innerHTML = `
        <div class="au-v2-cover" style="background-image:url('${media.coverImage?.large}')"></div>
        <div class="au-v2-form">
          <div class="au-v2-row">
            <label>Status<select id="au2-status">
              <option value="CURRENT" ${e.status==='CURRENT'?'selected':''}>Watching</option>
              <option value="PLANNING" ${e.status==='PLANNING'?'selected':''}>Planning</option>
              <option value="COMPLETED" ${e.status==='COMPLETED'?'selected':''}>Completed</option>
              <option value="DROPPED" ${e.status==='DROPPED'?'selected':''}>Dropped</option>
              <option value="PAUSED" ${e.status==='PAUSED'?'selected':''}>Paused</option>
            </select></label>
            <label>Score<input type="number" id="au2-score" value="${e.score??0}" min="0" max="100" step="0.1"></label>
            <label>Progress<input type="number" id="au2-progress" value="${e.progress??0}" min="0"> / ${media.episodes ?? '?'}</label>
          </div>
          <div class="au-v2-row">
            <label>Notes<textarea id="au2-notes" rows="3">${e.notes??''}</textarea></label>
          </div>
          <div class="au-v2-actions">
            <button id="au2-save" class="au-v2-btn-primary">Save</button>
            <button id="au2-cancel" class="au-v2-btn-secondary">Cancel</button>
          </div>
        </div>
      `;

      body.querySelector('#au2-cancel')!.addEventListener('click', () => {
        overlay!.classList.remove('au-v2-editor--open');
      });

      body.querySelector('#au2-save')!.addEventListener('click', () => {
        const btn = body.querySelector('#au2-save') as HTMLButtonElement;
        btn.textContent = 'Saving...';
        btn.disabled = true;

        anilistClient.query<any>(GQL_SAVE, {
          mediaId: media.id,
          status: (body.querySelector('#au2-status') as HTMLSelectElement).value,
          score: parseFloat((body.querySelector('#au2-score') as HTMLInputElement).value),
          progress: parseInt((body.querySelector('#au2-progress') as HTMLInputElement).value),
          notes: (body.querySelector('#au2-notes') as HTMLTextAreaElement).value,
          private: false,
        }).then((saveData: any) => {
          overlay!.classList.remove('au-v2-editor--open');
          
          // Update the local store with the new progress to trigger a re-render
          const newProgress = saveData?.SaveMediaListEntry?.progress;
          if (typeof newProgress === 'number') {
            calendarStore.updateEntry(media.id, { progress: newProgress });
          }
          
          window.dispatchEvent(new CustomEvent('calendar-preferences-updated'));
        }).catch(() => {
          btn.textContent = 'Save';
          btn.disabled = false;
          btn.style.background = '#ff4f4f';
        });
      });
    }).catch(() => {
      body.innerHTML = `<p style="color:#ff4f4f;padding:20px">Failed to load data. Check your login.</p>`;
    });
  }

  private async handleMarkWatched(): Promise<void> {
    const { anime, options } = this.props;

    if (options.onMarkWatched) {
      const pillSection = this.element.querySelector(
        '[data-action="mark-watched"]'
      ) as HTMLElement;

      // Show loading spinner in pill
      if (pillSection) {
        pillSection.style.pointerEvents = 'none';
        pillSection.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';
      }

      try {
        await options.onMarkWatched(anime.mediaId);
        // Restore icon after success
        if (pillSection) {
          pillSection.style.pointerEvents = '';
          pillSection.innerHTML = '<i class="fa fa-plus"></i>';
        }
      } catch (error) {
        // Restore on error
        if (pillSection) {
          pillSection.style.pointerEvents = '';
          pillSection.innerHTML = '<i class="fa fa-plus"></i>';
        }
      }
    }
  }

  private showCardTooltip(text: string, e: MouseEvent): void {
    let tip = document.querySelector('.au-card-tooltip') as HTMLElement;
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'au-card-tooltip';
      document.body.appendChild(tip);
    }
    tip.textContent = text;
    tip.style.display = 'block';
    tip.style.left = `${e.clientX + 16}px`;
    tip.style.top = `${e.clientY + 14}px`;
  }

  private moveCardTooltip(e: MouseEvent): void {
    const tip = document.querySelector('.au-card-tooltip') as HTMLElement;
    if (tip) {
      tip.style.left = `${e.clientX + 16}px`;
      tip.style.top = `${e.clientY + 14}px`;
    }
  }

  private hideCardTooltip(): void {
    const tip = document.querySelector('.au-card-tooltip') as HTMLElement;
    if (tip) tip.style.display = 'none';
  }


  public updateTime(timeFormat: 'release' | 'countdown'): void {
    const timeElement = this.element.querySelector('.anime-card__time');
    if (!timeElement) return;

    const { anime } = this.props;

    if (timeFormat === 'countdown') {
      timeElement.textContent = calendarService.formatTimeUntilAiring(anime.timeUntilAiring);
    } else {
      timeElement.textContent = calendarService.formatAiringTime(anime.airingAt);
    }
  }

  /**
   * Hide the card
   */
  public hide(): void {
    this.element.classList.add('anime-card--hidden');
  }

  /**
   * Show the card
   */
  public show(): void {
    this.element.classList.remove('anime-card--hidden');
  }
}
