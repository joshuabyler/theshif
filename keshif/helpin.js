/** *******************************

 keshif library

 Copyright (c) 2014-2016, University of Maryland
 All rights reserved.

 Redistribution and use in source and binary forms, with or without
 modification, are permitted provided that the following conditions are met:

 * Redistributions of source code must retain the above copyright notice, this
 list of conditions and the following disclaimer.

 * Redistributions in binary form must reproduce the above copyright notice,
 this list of conditions and the following disclaimer in the documentation
 and/or other materials provided with the distribution.

 * Neither the name of the University of Maryland nor the names of its contributors
 may not be used to endorse or promote products derived from this software
 without specific prior written permission.

 THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 DISCLAIMED. IN NO EVENT SHALL MICHAEL BOSTOCK BE LIABLE FOR ANY DIRECT,
 INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
 BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
 EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

 ************************************ */

import * as d3 from 'd3';
import _material from './helpinMaterial';
import Tipsy from './tipsy';


let exp_basis = false;
let exp_helpin = false;
let exp_train = false;

if (location.search === '?exp=basis') {
  exp_basis = true;
}
if (location.search === '?exp=helpin') {
  exp_helpin = true;
}
if (location.search === '?exp=train') {
  exp_train = true;
}

const Helpin = function (browser) {
  const me = this;
  this.browser = browser;

  this.DOM = {
    root: browser.DOM.root.select('.overlay_help'),
    overlay_answer: browser.panel_overlay.append('span').attr('class', 'overlay_answer'),
    overlay_control: browser.panel_overlay.append('span').attr('class', 'overlay_help_control'),
  };

  if (exp_basis) this.browser.DOM.root.attr('exp', 'basis');
  if (exp_helpin) this.browser.DOM.root.attr('exp', 'helpin');
  if (exp_train) this.browser.DOM.root.attr('exp', 'train');

  // Tracking actions in the main app
  this.actionHistory = [];
  this.topicHistory = [];
  browser.DOM.root.on('click.helpin', () => {
    // skip clicks on the help or other overlay panels
    const DOM = d3.event.target;
    if (DOM.matches('.panel_overlay *')) return;
    if (DOM.matches('.showHelpIn')) return; // skip click on help button
    me.actionHistory = [DOM].concat(me.actionHistory.slice(0, 19));
    // add to topicHistory
    me.topicsList.forEach(function (topic) {
      topic.tAnswer.forEach((answer) => {
        const selector = answer.matches;
        if (selector === undefined) return;
        if (DOM.matches(`.kshf ${selector}`)) {
          me.topicHistory = [topic].concat(me.topicHistory.slice(0, 19));
        }
      }, this);
    });
  });

  this.topicsList = [];

  this.timeouts = [];

  this.actionsList = [];
  this.keywordsList = [];
  this.keywordsIndexed = {};
  this.tooltips = [];
  this.topicsByDOMSelector = {};

  this.context = {};

  this.qFilters = {
    actions: [],
    topics: [],
    textSearch: '',
    relevant: true,
  };

  this.selectedTopic = null;
  this.GuidedTourStep = 0;

  this.enabledNotif = true;

  // Sample notify action - 3 second delay
  if (!exp_helpin && !exp_basis && !exp_train) {
    setTimeout(() => {
      me.notifyAction = { topic: _material._topics.T_ChangeMetric };
      me.browser.DOM.notifyButton.style('display', 'inline-block');
    }, 3000);
  }

  this.initData();

  let x = null;
  let y = null;

  document.addEventListener('mousemove', (e) => { x = e.pageX; y = e.pageY; });

  this.helpOnKey = false;
  document.onkeydown = function (e) {
    switch (event.keyCode) {
      case 27: // escape
        me.closePanel();
        break;
      case 37: // left
        if (me.browser.panel_overlay.attr('show') === 'help-guidedtour') me.showTourStep_Prev();
        break;
      case 39: // right
        if (me.browser.panel_overlay.attr('show') === 'help-guidedtour') me.showTourStep_Next();
        break;
      case 72: // h-H
      case 80: // p-P
        me.helpOnKey = true;
        me.showPointNLearn();
        d3.event = { clientX: x, clientY: y };
        me.dynamicPointed();
        me.freezePointed(me.theStencil);
        me.helpOnKey = false;
        break;
      case 84: // t-T
        me.helpOnKey = true;
        me.showTopicListing();
        event.stopPropagation();
        event.preventDefault();
        me.helpOnKey = false;
        break;
      case 71: // g-G
        me.helpOnKey = true;
        me.showGuidedTour();
        me.helpOnKey = false;
        break;
      case 79: // o-O
        me.helpOnKey = true;
        me.showOverview();
        me.helpOnKey = false;
        break;
    }
  };
};

Helpin.prototype = {
  /** -- */
  evaluateContext(topic, in_summary) {
    // Initialize context elements
    // Need to do it for every topic, since these arrays can be filtered in evaluation process.
    this.context.summaries = (in_summary) ? [in_summary] : this.browser.summaries;
    this.context.browser = this.browser;
    this.context.recordDisplay = this.browser.recordDisplay;

    topic.isRelevant = true;
    topic.relevanceWeight = topic.weight ? topic.weight : 0;

    topic.context.forEach(function (c) {
      let isRelevant = false;
      let multiplier = 1;
      if (typeof c.topicContext.v === 'object') {
        if (c.topicContext.v.summaries) {
          this.context.summaries = this.context.summaries.filter(c.topicContext.v.summaries);
          isRelevant = this.context.summaries.length > 0;
          multiplier = 1 + (this.context.summaries.length * 0.01);
        }
      } else if (typeof c.topicContext.v === 'function') {
        isRelevant = c.topicContext.v.call(this.context);
        if (isRelevant === undefined || isRelevant === null || isRelevant === []) isRelevant = false;
      }

      let weight = 0;
      if (isRelevant) { // relevant, or can be made relevant with another action
        weight = c.topicContext.weight;
      } else if (c.topicContext.fixBy) {
        weight = c.topicContext.weight / 2;
      }
      weight = Math.pow(weight, multiplier);

      topic.relevanceWeight += weight;

      c.isRelevant = isRelevant;

      topic.isRelevant = topic.isRelevant && isRelevant;
    }, this);

    topic.usedPos = -1;
    this.topicHistory.some((histTopic, i) => {
      if (histTopic === topic) {
        topic.usedPos = i;
        return true;
      }
      return false;
    });

    // rank by user actions
    if (topic.usedPos !== -1 && (this.rankByUnusued() || this.rankByMostRecent())) {
      if (this.rankByUnusued()) {
        // penalty for most recently used items
        topic.relevanceWeight -= (21 - topic.usedPos) * 200;
      } else if (this.rankByMostRecent()) {
        // bonus for most recently used items
        topic.relevanceWeight += (21 - topic.usedPos) * 200;
      }
    }
  },
  /** -- */
  context_highlight(answer) {
    if (answer.cElement === undefined) return;

    const context_group = answer.cElement;
    const DOM_class = answer.class;
    const matches = answer.matches;

    kshf.activeTipsy = null;

    // Traverse the elements, extract related stuff
    this.context.HighlightedDOM = [];

    const extractHighlightedDOMs = function (CCC) {
      let DOMs;
      if (DOM_class) {
        if (typeof DOM_class === 'function') {
          DOMs = DOM_class.call(CCC).nodes();
        } if (typeof DOM_class === 'string') {
          DOMs = CCC.DOM[DOM_class].nodes();
        }
      } else {
        DOMs = CCC.DOM.root.selectAll(matches).nodes();
      }
      if (Array.isArray(DOMs)) {
        this.context.HighlightedDOM = this.context.HighlightedDOM.concat(DOMs);
      } else {
        this.context.HighlightedDOM.push(DOMs);
      }
    };

    if (Array.isArray(this.context[context_group])) {
      this.context[context_group].forEach(extractHighlightedDOMs, this);
    } else {
      extractHighlightedDOMs.call(this, this.context[context_group]);
    }

    if (answer.filter) answer.filter.call(this);
    if (answer.activate) answer.activate.call(this);
    if (answer.animate) this.activateAnimations(answer.animate);

    // inject CSS style and track all the highlighted DOM's
    this.context.HighlightedDOM.forEach(function (DOM) {
      this.context.HighlightedDOM_All.push(DOM);
      DOM.setAttribute('helpin', true);
    }, this);

    // Highlight with given text
    this.fHighlightBox(answer.text, answer.pos);
  },
  /** -- */
  activateAnimations(animations) {
    const me = this;
    const s = this.DOM.SelectedThing_Content.select('.animationProgressIn');
    s.attr('play', null);
    this.DOM.SelectedThing_Content.select('.animationReplay').remove();
    window.setTimeout(() => {
      s.style('animation-duration', `${animations[animations.length - 1].t + 1}s`);
      s.attr('play', true);
    }, 50);

    animations.forEach(function (a) {
      this.timeouts.push(
        window.setTimeout(
          () => { a.v.call(me); },
          a.t * 1000,
        ),
      );
    }, this);
  },
  /** -- */
  clearAnimations() {
    this.timeouts.forEach((a) => { window.clearTimeout(a); });
    this.timeouts = [];
  },
  /** -- */
  getTopicTitle(topic) {
    const str = `<span class='topicWeight'> (${Math.round(topic.relevanceWeight)}) </span>`;
    if (typeof topic.q === 'string') return topic.q + str;
    if (typeof topic.q === 'function') return topic.q.call(this, topic) + str;
  },
  /** -- */
  getIcon(word, prefix) {
    const v = word.replace(' ', '_').replace('/', '_').toLowerCase();
    if (_material._icons[v]) return `${prefix} fa fa-${_material._icons[v]}`;
    return '';
  },
  /** -- */
  initData() {
    const actions_by_name = {};
    const topics_by_name = {};

    for (const i in _material._topics) {
      _material._topics[i].id = i;
      this.topicsList.push(_material._topics[i]);
    }

    this.topicsList.forEach(function (q) {
      q.displayed = true;

      if (q.context === undefined) q.context = 'True';
      if (!Array.isArray(q.context)) q.context = [q.context];
      q.context.forEach((c, i) => {
        q.context[i] = {
          isRelevant: true,
          topicContext: _material._contextFeatures[c],
        };
      });

      // Answer
      if (q.tAnswer === undefined) q.tAnswer = [];
      if (!Array.isArray(q.tAnswer)) q.tAnswer = [q.tAnswer];

      if (q.animate) {
        const orderedAnimate = [];
        for (const sec in q.animate) {
          orderedAnimate.push({ t: 1 * sec, v: q.animate[sec] });
        }
        q.animate = orderedAnimate.sort((a, b) => a.t - b.t);
      }

      function addByDOMSelector(answer) {
        let selector;
        if (answer.class) {
          selector = `.${answer.class}`;
        } else if (answer.matches) {
          selector = answer.matches;
        } else {
          return; // TODO: See if any answers falls through this.
        }
        if (this.topicsByDOMSelector[selector] === undefined) this.topicsByDOMSelector[selector] = [];
        this.topicsByDOMSelector[selector].push(q);
      }
      q.tAnswer.forEach(function (answer, i) {
        if (typeof answer === 'string') {
          q.tAnswer[i] = { text: answer };
          return;
        }
        if (answer.sequence) {
          answer.sequence.forEach(function (a, j) {
            if (typeof a === 'string') {
              answer.sequence[j] = { text: a };
              return;
            }
            addByDOMSelector.call(this, a);
          }, this);
        } else {
          addByDOMSelector.call(this, answer);
        }
        if (answer.class && answer.matches === undefined) {
          answer.matches = `.${answer.class}`;
        }
      }, this);

      if (q.similarTopics === undefined) q.similarTopics = [];


      // Split Actions
      if (q.actions === undefined) {
        q.actions = '';
      }
      let splitActions = q.actions.split('+');
      if (splitActions[0] === '') splitActions = [];
      splitActions.forEach((actionName) => {
        if (actions_by_name[actionName]) {
          actions_by_name[actionName].push(q);
        } else {
          actions_by_name[actionName] = [q];
        }
      });

      // Split Topics
      if (q.topics === undefined) {
        q.topics = '';
      }
      let splitTopics = q.topics.split('+');
      if (splitTopics[0] === '') splitTopics = [];
      splitTopics.forEach((topicName) => {
        if (topics_by_name[topicName]) {
          topics_by_name[topicName].push(q);
        } else {
          topics_by_name[topicName] = [q];
        }
      });
      //
      // // if (typeof q.topics === 'object') {
      // //   q.topics = q.topics.join('+');
      // // } else {
      // //   q.topics = q.topics.split('+');
      // // }
      // // q.topics = q.topics.split("+");
      // if(q.topics[0]==="") q.topics = [];
      // q.topics.forEach(function(topicName){
      //   if(topics_by_name[topicName]) topics_by_name[topicName].push(q); else topics_by_name[topicName] = [q];
      // });
    }, this);

    for (var v in actions_by_name) {
      this.actionsList.push({ name: v, questions: actions_by_name[v], selected: false });
    }
    for (var v in topics_by_name) {
      const TT = { name: v, questions: topics_by_name[v], selected: false };
      this.keywordsList.push(TT);
      this.keywordsIndexed[v] = TT;
    }
  },
  /** -- */
  showOverview() {
    const me = this;

    this.initDOM();
    this.showHelpPanel();
    this.removeTooltips();

    this.closeTopic();
    this.closePointNLearn();

    this.DOM.overlay_control.selectAll('[class^="helpInMode_"]').attr('active', null);
    this.DOM.overlay_control.select('.helpInMode_Overview').attr('active', true);

    this.browser.panel_overlay.attr('show', 'help-overview');
    this.DOM.root
      .styles({ left: null, right: null, top: null, bottom: null })
      .attr('hideRelatedTopics', true);

    // change title
    this.DOM.SelectedThing_Header.select('.hContent').text('Overview of Data Browser');

    // change content
    let content = '';
    const recordName = this.browser.recordName;

    let numSum = 0;
    let sampleNames = '';
    this.browser.summaries.forEach((summary, i) => {
      if (summary.inBrowser()) {
        numSum++;
        if (i === 0) sampleNames += `<i>${summary.summaryName}</i> `;
        if (i === 1) sampleNames += ` or <i>${summary.summaryName}</i>`;
      }
    });

    content += `${'<p>' +
      "<span class='bolder'>"}${this.browser.records.length.toLocaleString()} ${recordName}</span> ` +
      `are summarized with their <span class='bolder'>${numSum}</span>` +
      ` attributes (such as ${sampleNames}).</p>`;

    if (this.browser.isFiltered()) {
      const globalActive = this.browser.allRecordsAggr.recCnt.Active;
      const globalActiveMeasure = this.browser.allRecordsAggr._measure.Active.toLocaleString();
      let filterStr = '';
      this.browser.filters.forEach((filter) => {
        if (!filter.isFiltered) return false;
        filterStr += filter.filterCrumb.DOM.node().outerHTML;
      });

      let off = '';
      switch (this.browser.measureFunc) {
        case 'Count': off = `${globalActive.toLocaleString()} ${recordName}`; break;
        case 'Sum': off = `${globalActiveMeasure} Total ${this.browser.measureSummary.summaryName
        } of ${globalActive} ${recordName}`; break;
        case 'Avg': off = `${globalActiveMeasure} Average ${this.browser.measureSummary.summaryName
        } of ${globalActive} ${recordName}`; break;
      }

      content += `<p><span class='bolder'>${off}</span> remain after filtering on ${filterStr}.</p>`;
    }

    // highlight selection

    // metric
    // visual scale mode
    const _metric = getMetricText.call(this.browser);

    let encoding = '<p>The charts show the ';
    if (this.browser.ratioModeActive) encoding += 'percentage of the ';
    encoding += `<span class='bolder'>${_metric}</span> `;
    if (this.browser.ratioModeActive) { encoding += `among ${this.browser.isFiltered() ? 'filtered' : 'all'} ${recordName} `; }
    encoding += 'per category/range (for the current selection). ';

    content += encoding;
    if (this.browser.isFiltered()) {
      content += "<br><span class='encodingInfo'><span class='colorCoding_Active'></span></span> shows " +
        'the active (filtered) selection. ' +
        "<span class='topicLink weakTopicLink' topicName='T_ClearFilters'>(Clear)</span>";
    }
    if (this.browser.highlightSelectedSummary) {
      content += `<br><span class='encodingInfo'><span class='colorCoding_Highlight'></span></span> shows ${
        this.browser.crumb_Highlight.DOM.node().outerHTML}highlighted-selection. `;
    }
    if (this.browser.selectedAggr.Compare_A) {
      content += `${"<br><span class='encodingInfo'><span class='colorCoding_Compare_A'></span></span> shows " +
        'a locked-selection '}${this.browser.crumb_Compare_A.DOM.node().outerHTML}. ` +
        '<span class=\'topicLink weakTopicLink\' topicName=\'T_UnlockSelection\'>(Unlock)</span>';
    }
    if (this.browser.selectedAggr.Compare_B) {
      content += `${"<br><span class='encodingInfo'><span class='colorCoding_Compare_B'></span></span> shows " +
        'a locked-selection '}${this.browser.crumb_Compare_B.DOM.node().outerHTML}. ` +
        '<span class=\'topicLink weakTopicLink\' topicName=\'T_UnlockSelection\'>(Unlock)</span>';
    }
    if (this.browser.selectedAggr.Compare_C) {
      content += `${"<br><span class='encodingInfo'><span class='colorCoding_Compare_C'></span></span> shows " +
        'a locked-selection '}${this.browser.crumb_Compare_C.DOM.node().outerHTML}. ` +
        '<span class=\'topicLink weakTopicLink\' topicName=\'T_UnlockSelection\'>(Unlock)</span>';
    }
    content += '<p>';

    // ****************** SUMMARY OF MODES *********************
    content += '<p>';

    content += `The metric is <span class='bolder'>${_metric}</span>. ` +
      '<span class=\'topicLink weakTopicLink\' topicName=\'T_ChangeMetric\'>(Change)</span><br>';
    content += `The visual scale mode is <span class='bolder'>${
      this.browser.ratioModeActive ? 'part-of-active' : 'absolute'}</span>. ` +
      '<span class=\'topicLink weakTopicLink\' topicName=\'T_ChangeVisualScale\'>(Change)</span><br>';
    content += `The measurement-labels show <span class='bolder'>${
      this.browser.percentModeActive ? 'percent (%) of records' : 'absolute (#) value'}</span>. ` +
      '<span class=\'topicLink weakTopicLink\' topicName=\'T_ChangeMeasureLabel\'>(Change)</span><br>';

    content += '</p>';
    // ****************** -END- SUMMARY OF MODES *********************

    this.DOM.SelectedThing_Content.html(content);
    this.DOM.SelectedThing_Content_More.html('').style('display', 'none');

    this.processThingContent();
  },
  /** -- */
  processThingContent() {
    const me = this;
    this.DOM.SelectedThing_Content.selectAll('.topicLink').on('click', function () {
      me.selectTopic(_material._topics[this.getAttribute('topicName')]);
    });
    this.DOM.SelectedThing_Content_More.selectAll('.topicLink').on('click', function () {
      me.selectTopic(_material._topics[this.getAttribute('topicName')]);
    });
  },
  /** -- */
  showTopicListing() {
    const me = this;

    this.initDOM();
    this.showHelpPanel();
    this.removeTooltips();

    this.closeTopic();
    this.closePointNLearn();

    this.DOM.overlay_control.selectAll('[class^="helpInMode_"]').attr('active', null);
    this.DOM.overlay_control.select('.helpInMode_TopicListing').attr('active', true);

    this.browser.panel_overlay.attr('show', 'help-topiclisting');
    this.DOM.root
      .styles({ left: null, right: null, top: null, bottom: null })
      .attr('hideRelatedTopics', null);

    this.DOM.TopicBlock.style('font-size', null);

    this.DOM.TopicsList.node().scrollTop = 0;

    // Clear all filtering. :: TODO: Check / incomplete
    while (true) {
      if (this.qFilters.topics.length === 0) break;
      this.unselectKeyword(this.qFilters.topics[0]);
    }
    this.DOM.SearchTextBox.node().focus();

    this.filterTopics();
  },
  /** -- */
  initDOM() {
    const me = this;

    if (this.DOM.SelectedThing_Header) return;

    this.initDOM_ControlPanel();

    this.DOM.SelectedThing_Header = this.DOM.root.append('div').attr('class', 'SelectedThing_Header')
    // click & drag the panel
      .on('mousedown', (d, i) => {
        me.movingBox = true;
        me.browser.DOM.root.attr('drag_cursor', 'grabbing');

        me.DOM.root.style('box-shadow', '0px 0px 40px #111');

        me.DOM.root.style('transition', 'none');
        // MOVE HELPIN BOX
        const initPos = d3.mouse(d3.select('body').node());
        const DOM = me.DOM.root.node();
        const initLeft = DOM.offsetLeft; // position relative to parent
        const initTop = DOM.offsetTop; // position relative to parent
        const boxWidth = DOM.getBoundingClientRect().width;
        const boxHeight = DOM.getBoundingClientRect().height;
        const maxLeft = me.browser.DOM.root.node().getBoundingClientRect().width - boxWidth;
        const maxTop = me.browser.DOM.root.node().getBoundingClientRect().height - boxHeight;
        me.browser.DOM.root.on('mousemove', () => {
          const newPos = d3.mouse(d3.select('body').node());
          DOM.style.left = `${Math.min(maxLeft, Math.max(0, initLeft - initPos[0] + newPos[0]))}px`;
          DOM.style.top = `${Math.min(maxTop, Math.max(0, initTop - initPos[1] + newPos[1]))}px`;
        }).on('mouseup', () => {
          me.movingBox = false;
          me.DOM.root.style('transition', null);
          me.DOM.root.style('box-shadow', null);
          me.browser.DOM.root.attr('drag_cursor', null).on('mousemove', null).on('mouseup', null);
        });
      });
    this.DOM.SelectedThing_Header.append('span').attr('class', 'hContent');
    this.DOM.SelectedThing_Header.append('span').attr('class', 'backButton fa fa-arrow-left')
      .on('click', () => {
        switch (me.browser.panel_overlay.attr('show')) {
          case 'help-pointnlearn': me.showPointNLearn(); break;
          case 'help-topiclisting': me.showTopicListing(); break;
          case 'help-overview': me.showOverview(); break;
        }
      });

    this.initDOM_GuidedTour();

    this.DOM.SelectedThing_Content = this.DOM.root.append('div').attr('class', 'SelectedThing_Content');
    this.DOM.SelectedThing_Content_More = this.DOM.root.append('div').attr('class', 'SelectedThing_Content_More');

    // RELEVANT WHEN... BLOCK
    this.DOM.TopicRelWhenBlock = this.DOM.root.append('div').attr('class', 'TopicInfoBlock TopicRelWhenBlock');
    this.DOM.TopicRelWhenBlock.append('div').attr('class', 'TopicInfoHeader').text('Relevant when ...');
    this.DOM.TopicRelWhenBlock.append('div').attr('class', 'TopicInfoShowHide')
      .on('click', () => {
        me.DOM.TopicRelWhenBlock.attr('showBlockContent', me.DOM.TopicRelWhenBlock.attr('showBlockContent') === 'false');
      });
    this.DOM.ContextContent = this.DOM.TopicRelWhenBlock.append('div').attr('class', 'TopicInfoBlockContent ContextContent');

    this.DOM.RelatedTopics = this.DOM.root.append('div').attr('class', 'RelatedTopics')
      .html('Related Topics')
      .on('click', () => {
        if (me.DOM.root.attr('hideRelatedTopics') === 'true') {
          me.DOM.root.attr('hideRelatedTopics', null);
          me.checkBoxBoundaries();
        } else {
          me.DOM.root.attr('hideRelatedTopics', true);
        }
      });
    this.DOM.RelatedTopics.append('div').attr('class', 'TopicInfoShowHide');

    this.DOM.heyooo = this.DOM.root.append('div').attr('class', 'heyooo');

    this.DOM.browseTopicBlock = this.DOM.heyooo.append('div').attr('class', 'browseTopicBlock');
    this.DOM.SearchBlock = this.DOM.browseTopicBlock.append('div').attr('class', 'SearchBlock');

    this.initDOM_TextSearch();
    this.initDOM_FilterTypes();
    this.initDOM_TopicList();
    this.initDOM_PointNClickInfo();

    // this.showPointNLearn(); // default mode on initialization
  },
  /** -- */
  initDOM_PointNClickInfo() {
    const me = this;
    const X = this.DOM.root.append('div').attr('class', 'PointNClick_Info');
    X.append('div').attr('class', 'DescriptionToFreeze')
      .html("<i class='fa fa-bullseye'></i> <b>Click to freeze selection</b>");
    X.append('div').attr('class', 'DescriptionToUnFreeze')
      .html("<i class='fa fa-bullseye'></i> <b>Click to un-freeze selection</b>")
      .on('click', () => { me.unfreezePointed(); });
  },
  /** -- */
  initDOM_ControlPanel() {
    const me = this;

    this.DOM.overlay_control
      .on('mouseenter', function () { d3.select(this).classed('expanded', true); })
      .on('mouseleave', function () {
        if (me.browser.panel_overlay.attr('show') === 'help-overlayonly') return;
        d3.select(this).classed('expanded', false);
      });

    this.DOM.overlay_control.append('div').attr('class', 'overlay_Close fa fa-times-circle')
      .each(function () { this.tipsy = new Tipsy(this, { gravity: 'e', title: 'Close Help (Escape)' }); })
      .on('mouseenter', function () { this.tipsy.show(); })
      .on('mouseleave', function () { this.tipsy.hide(); })
      .on('click', function () { this.tipsy.hide(); me.closePanel(); });

    this.DOM.overlay_control.append('span').attr('class', 'GetHelpHeader').text('Get Help');

    const helpInModes = this.DOM.overlay_control.append('div').attr('class', 'helpInModes');

    helpInModes.append('span').attr('class', 'helpInMode_TopicListing')
      .html("<i class='fa fa-book'></i> Topic Listing")
      .each(function () { this.tipsy = new Tipsy(this, { gravity: 'e', title: 'Browse help topics' }); })
      .on('mouseenter', function () { this.tipsy.show(); })
      .on('mouseleave', function () { this.tipsy.hide(); })
      .on('click', function () { this.tipsy.hide(); me.showTopicListing(); });

    if (exp_basis) return;
    helpInModes.append('span').attr('class', 'helpInMode_Overview')
      .html("<i class='fa fa-binoculars'></i> Overview")
      .each(function () { this.tipsy = new Tipsy(this, { gravity: 'e', title: 'Get quick overview' }); })
      .on('mouseenter', function () { this.tipsy.show(); })
      .on('mouseleave', function () { this.tipsy.hide(); })
      .on('click', function () { this.tipsy.hide(); me.showOverview(); });
    helpInModes.append('span').attr('class', 'helpInMode_PointNLearn')
      .html("<i class='fa fa-hand-pointer-o'></i> Point &amp; Learn")
      .each(function () { this.tipsy = new Tipsy(this, { gravity: 'e', title: 'Point to select' }); })
      .on('mouseenter', function () { this.tipsy.show(); })
      .on('mouseleave', function () { this.tipsy.hide(); })
      .on('click', () => { me.showPointNLearn(); });

    if (exp_helpin || exp_train) return;
    helpInModes.append('span').attr('class', 'helpInMode_GuidedTour')
      .html("<i class='fa fa-location-arrow'></i> Guided Tour")
      .each(function () { this.tipsy = new Tipsy(this, { gravity: 'e', title: 'Step-by-step introduction' }); })
      .on('mouseenter', function () { this.tipsy.show(); })
      .on('mouseleave', function () { this.tipsy.hide(); })
      .on('click', () => { me.showGuidedTour(); });
    helpInModes.append('span').attr('class', 'helpInMode_Notification enabled')
      .html("<i class='fa fa-bell'></i> Notifications <i class='fa fa-toggle-on'></i>")
      .each(function () { this.tipsy = new Tipsy(this, { gravity: 'e', title: 'Enable/disable<br> help notifications' }); })
      .on('mouseenter', function () { this.tipsy.show(); })
      .on('mouseleave', function () { this.tipsy.hide(); })
      .on('click', function () {
        this.tipsy.hide();
        me.enabledNotif = !me.enabledNotif;
        d3.select(this).classed('enabled', me.enabledNotif);
      });
    helpInModes.append('a').attr('class', 'helpInMode_Video').attr('target', '_blank')
      .style('margin-top', '6px')
      .html("<i class='fa fa-youtube-play'></i> Video Tutorial")
      .attr('href', 'http://www.youtube.com/watch?v=3Hmvms-1grU');
    helpInModes.append('a').attr('class', 'helpInMode_Wiki').attr('target', '_blank')
      .html("<i class='fa fa-code'></i> API &amp; More")
      .attr('href', 'http://www.github.com/adilyalcin/Keshif/wiki');
  },
  /** -- */
  initDOM_GuidedTour() {
    const me = this;
    this.DOM.GuidedTour = this.DOM.root.append('div').attr('class', 'GuidedTour');

    this.DOM.GuidedTour.append('span').attr('class', 'GuidedTourHead')
      .html("<i class='fa fa-location-arrow'></i> Guided Tour");

    this.DOM.GuidedTour.append('span').attr('class', 'TourStep PreviousStep')
      .html("<i class='fa fa-arrow-left' style='color: gray;'></i> Previous")
      .on('click', () => { me.showTourStep_Prev(); });
    this.DOM.GuidedTour.append('span').attr('class', 'TourStep NextStep')
      .html("Next <i class='fa fa-arrow-circle-right'></i>")
      .on('click', () => { me.showTourStep_Next(); });

    this.DOM.GuidedTourProgressBar = this.DOM.GuidedTour.append('div').attr('class', 'GuidedTourProgressBar');

    this.DOM.GuidedTourCurrentStep = this.DOM.GuidedTourProgressBar.append('span')
      .attr('class', 'GuidedTourStep GuidedTourCurrentStep');
  },
  /** -- */
  initDOM_TextSearch() {
    const me = this;
    const browser = this.browser;
    this.DOM.TextSearchBlock = this.DOM.SearchBlock.append('div').attr('class', 'TextSearchBlock');
    this.DOM.TextSearchBlock.append('span').attr('class', 'HowDoI').html('How do I ?');
    this.DOM.SearchTextBox = this.DOM.TextSearchBlock.append('input').attr('class', 'SearchTextBox')
      .attr('type', 'text')
      .attr('placeholder', 'explore data')
      .on('keydown', () => { d3.event.stopPropagation(); })
      .on('keypress', () => { d3.event.stopPropagation(); })
      .on('keyup', function () {
        me.qFilters.textSearch = this.value.toLowerCase();
        if (me.qFilters.textSearch !== '') {
          const pattern = new RegExp(`(${me.qFilters.textSearch})`, 'gi');
          const replaceWith = "<span class='textSearch_highlight'>$1</span>";
          me.DOM.TopicText.html(topic => me.getTopicTitle(topic).replace(pattern, replaceWith));
        } else {
          me.DOM.TopicText.html(topic => me.getTopicTitle(topic));
        }
        me.filterTopics();
        d3.event.stopPropagation();
      });
  },
  /** -- */
  initDOM_FilterTypes() {
    const me = this;

    // INSERT ACTIONS INTO DOM
    this.DOM.ActionTypes = this.DOM.browseTopicBlock.append('div').attr('class', 'QuestionTypes ActionTypes');
    this.DOM.ActionTypes.append('span').attr('class', 'TypeLabel');
    this.DOM.ActionSelect = this.DOM.ActionTypes
      .append('span').attr('class', 'TypeGroup')
      .selectAll('.QuestionTypeSelect')
      .data(this.actionsList, action => action.name)
      .enter()
      .append('div')
      .attr('class', 'QuestionTypeSelect')
      .attr('selected', false)
      .each(function (action) { action.DOM = this; })
      .on('click', function (action) {
        action.selected = !action.selected;
        this.setAttribute('selected', action.selected);
        if (action.selected) {
          me.qFilters.actions.push(action);
        } else {
          me.qFilters.actions.splice(me.qFilters.actions.indexOf(action), 1); // remove
        }
        me.filterTopics();
      });
    this.DOM.ActionSelect.append('span').attr('class', 'label').html(tag => tag.name);
    this.DOM.ActionSelect.append('span').attr('class', 'num');
    this.DOM.ActionSelect.append('span').attr('class', function (tag) {
      const x = me.getIcon(tag.name, 'topicInfoMark');
      if (x !== '') this.parentNode.setAttribute('hasIcon', true);
      return x;
    });

    // INSERT TOPICS INTO DOM
    this.DOM.TopicTypes = this.DOM.browseTopicBlock.append('div').attr('class', 'QuestionTypes TopicTypes');
    this.DOM.TopicTypes.append('span').attr('class', 'TypeLabel');
    this.DOM.TopicSelect = this.DOM.TopicTypes
      .append('span').attr('class', 'TypeGroup')
      .selectAll('.QuestionTypeSelect')
      .data(this.keywordsList, topic => topic.name)
      .enter()
      .append('div')
      .attr('class', 'QuestionTypeSelect')
      .attr('selected', false)
      .each(function (keyword) { keyword.DOM = this; })
      .on('click', (keyword) => {
        me.swapselectKeyword(keyword);
        me.filterTopics();
      })
      .attr('title', tag => tag.name);
    this.DOM.TopicSelect.append('span').attr('class', 'label').html(tag => tag.name);
    this.DOM.TopicSelect.append('span').attr('class', 'num');
    this.DOM.TopicSelect.append('span').attr('class', function (tag) {
      const x = me.getIcon(tag.name, 'topicInfoMark');
      if (x !== '') this.parentNode.setAttribute('hasIcon', true);
      return x;
    });

    this.DOM.BrowseOptions = this.DOM.browseTopicBlock.append('div').attr('class', 'BrowseOptions');

    let x;

    x = this.DOM.BrowseOptions.append('div').attr('class', 'checkBoxArea')
      .each(function () {
        this.tipsy = new Tipsy(this, { gravity: 's', title: 'Show topics that do not<br> match current settings' });
      })
      .on('mouseenter', function () { this.tipsy.show(); })
      .on('mouseleave', function () { this.tipsy.hide(); });
    this.DOM.checkboxRelevant = x.append('input').attr('type', 'checkbox').attr('id', 'checkboxRelevant')
      .attr('checked', true)
      .on('change', () => { me.filterTopics(); });
    x = x.append('label').attr('for', 'checkboxRelevant');
    x.append('span').attr('class', 'ShowHide');
    x.append('span').html(' non-relevant topics');

    x = this.DOM.BrowseOptions.append('div').attr('class', 'checkBoxArea')
      .each(function () {
        this.tipsy = new Tipsy(this, { gravity: 's', title: "Prioritize features that<br> you haven't used yet." });
      })
      .on('mouseenter', function () { this.tipsy.show(); })
      .on('mouseleave', function () { this.tipsy.hide(); });
    this.DOM.checkboxPrioritize = x.append('input').attr('type', 'checkbox').attr('id', 'checkboxPrioritize')
      .on('change', () => {
        if (me.DOM.checkboxPrioritize.node().checked) {
          me.DOM.checkboxPrioritizeRecent.node().checked = false;
        }
        me.filterTopics();
      });
    x.append('label').attr('for', 'checkboxPrioritize').html('Prioritize unused');

    x = this.DOM.BrowseOptions.append('div').attr('class', 'checkBoxArea')
      .each(function () {
        this.tipsy = new Tipsy(this, { gravity: 's', title: 'Prioritize features that<br> you have recently used.' });
      })
      .on('mouseenter', function () { this.tipsy.show(); })
      .on('mouseleave', function () { this.tipsy.hide(); });
    this.DOM.checkboxPrioritizeRecent = x.append('input').attr('type', 'checkbox').attr('id', 'checkboxPrioritizeRecent')
      .on('change', () => {
        if (me.DOM.checkboxPrioritizeRecent.node().checked) {
          me.DOM.checkboxPrioritize.node().checked = false;
        }
        me.filterTopics();
      });
    x.append('label').attr('for', 'checkboxPrioritizeRecent').html('Prioritize recently used');
  },
  /** -- */
  filterRelevantOnly() {
    return !this.DOM.checkboxRelevant.node().checked;
  },
  rankByUnusued() {
    return this.DOM.checkboxPrioritize.node().checked;
  },
  rankByMostRecent() {
    return this.DOM.checkboxPrioritizeRecent.node().checked;
  },
  /** -- */
  swapselectKeyword(keyword) {
    if (keyword.selected) { this.unselectKeyword(keyword); } else { this.selectKeyword(keyword); }
  },
  /** -- */
  selectKeyword(keyword) {
    if (keyword.selected) return;
    keyword.selected = true;
    keyword.DOM.setAttribute('selected', true);
    this.qFilters.topics.push(keyword);
  },
  /** -- */
  unselectKeyword(keyword) {
    if (!keyword.selected) return;
    keyword.selected = false;
    keyword.DOM.setAttribute('selected', false);
    this.qFilters.topics.splice(this.qFilters.topics.indexOf(keyword), 1);
  },
  /* -- */
  selectTopic(q) {
    const me = this;
    if (this.selectedTopic === q) {
      return;
    } else if (this.selectedTopic) {
      this.closeTopic();
    }

    this.answerSequencePos = 0;

    this.closePointNLearn();

    this.selectedTopic = q;
    this.evaluateContext(q);

    this.browser.panel_overlay.attr('topicAnswer', 'true');

    this.DOM.overlay_answer.style('display', 'block');
    this.DOM.root.styles({ left: null, right: null, top: null, bottom: null });

    this.removeStencilBoxes();

    this.DOM.SelectedThing_Header.select('.hContent').html(this.getTopicTitle(q));

    // Context sort
    q.context = q.context.sort((a, b) => b.isRelevant - a.isRelevant);

    // Context show
    this.DOM.ContextContent.selectAll('.ContextItem').data([]).exit().remove();
    var X = this.DOM.ContextContent.selectAll('.ContextItem').data(q.context, c => c.topicContext.descr)
      .enter().append('div')
      .attr('class', 'ContextItem')
      .attr('isRelevant', c => c.isRelevant);
    X.append('i').attr('class', c => `RelevantIcon fa fa-${c.isRelevant ? 'check-circle' : 'times-circle'}`);
    X.append('span').html(c => c.topicContext.descr);
    X.filter(c => !c.isRelevant && c.topicContext.fixBy)
      .append('span').attr('class', 'MakeRelevantTopic').text('How?')
      .on('click', (c) => { me.selectTopic(_material._topics[c.topicContext.fixBy]); });

    this.DOM.TopicRelWhenBlock.attr('showBlockContent', !q.isRelevant);

    this.DOM.TopicBlock.style('display', 'none');
    q.similarTopics.forEach((c) => {
      if (_material._topics[c]) { _material._topics[c].DOM.style('display', 'block'); }
    });

    // put the answer in the help box (not on the element)
    me.DOM.SelectedThing_Content.html('');
    q.tAnswer.forEach(function (answer) {
      let t = '';
      if (answer.sequence) {
        answer.sequence.forEach(function (a) {
          let x = a.text;
          if (typeof x === 'function') x = x.call(this);
          t += `<span class='subAnswer'>${x}</span> `;
        });
      } else {
        t = answer.text;
        if (typeof t === 'function') t = t.call(this);
      }
      t = t.replace(/\<br\>/gi, ' ');
      if (t.length > 0) this.DOM.SelectedThing_Content.append('div').attr('class', 'answerTooltip').html(t);
    }, this);

    if (q.animate) {
      var X = this.DOM.SelectedThing_Content.append('div').attr('class', 'animateState');
      const Y = X.append('span').attr('class', 'animationProgress').append('span').attr('class', 'animationProgressIn');

      Y.node().addEventListener('animationend', () => {
        X.append('span').attr('class', 'animationReplay')
          .html("<i class='fa fa-repeat' style='font-size: 0.9em;'></i> Replay")
          .on('click', () => {
            me.removeTooltips();
            me.removeStencilBoxes();
            me.clearAnimations();
            if (q.deactivate) q.deactivate.call(me, q);
            setTimeout(() => {
              me.showIntegratedAnswer(q);
            }, 500); // a little delay
          });
      }, false);
    }

    this.showIntegratedAnswer(q);

    // Show topic note
    if (q.note || q.media) {
      let n = '';
      if (q.media) {
        if (!Array.isArray(q.media)) q.media = [q.media];
        if (exp_basis || !q.isRelevant) {
          q.media.forEach((mm) => {
            n += `<img class='topicMedia' src='./helpin/media/${mm}'>`;
            // n += "<img class='topicMedia' src='./helpin/media/"+mm+"'>";
          });
        }
      }
      if (q.note) {
        n += ((typeof q.note) === 'function') ? q.note.call(this) : q.note;
      }
      this.DOM.SelectedThing_Content_More.html(n).style('display', 'block');
    } else {
      this.DOM.SelectedThing_Content_More.html('').style('display', 'none');
    }

    this.processThingContent();

    if (!exp_basis) { this.repositionHelpMenu(); }
  },
  /** -- */
  showIntegratedAnswer(q) {
    if (q.isRelevant && !exp_basis) {
      this.context.HighlightedDOM = [];
      this.context.HighlightedDOM_All = []; // can be multiple calls...
      if (q.activate) q.activate.call(this, q);
      if (q.animate) this.activateAnimations(q.animate);
      if (q.tAnswer.length > 0) {
        q.tAnswer.forEach(function (answer) {
          if (answer.sequence) {
            this.context_highlight(answer.sequence[this.answerSequencePos]);
          } else {
            this.context_highlight(answer);
          }
        }, this);
        this.createStencils();
      }
    }
  },
  /** -- */
  createStencils() {
    // Create transparent window in the dark overlay on the interface
    const total_width = parseInt(this.browser.DOM.root.style('width'));
    const total_height = parseInt(this.browser.DOM.root.style('height'));
    let dPath = `M 0 0 h ${total_width} v ${total_height} h -${total_width} Z `;
    this.DOM.overlay_answer.selectAll('.stencilBox').each(function (d, i) {
      if (this.skipStencil) return;
      dPath += `M ${this.left} ${this.top} h ${this.width} v ${this.height} h -${this.width} Z `;
    });
    this.browser.DOM.kshfBackground.style('-webkit-mask-image',
      `${'url("data:image/svg+xml;utf8,' +
      "<svg xmlns='http://www.w3.org/2000/svg' width='"}${total_width}' height='${total_height}'>` +
      `<path d='${dPath}' fill-rule='evenodd' fill='black' /></svg>")`);
    // TODO: Check SVG validity. Firefox doesn't suport mask-image yet (it's slow as hell anyway.)
  },
  /** -- */
  removeStencilBoxes() {
    this.DOM.overlay_answer.selectAll('.stencilBox')
      .each((d) => {
        d.stencilBox = undefined;
      })
      .remove();
  },
  /** -- */
  initDOM_TopicList() {
    const me = this;

    this.DOM.TopicsList = this.DOM.heyooo.append('div').attr('class', 'TopicsList');
    this.DOM.TopicBlock = this.DOM.TopicsList
      .selectAll('.TopicBlock').data(this.topicsList, topic => topic.id).enter()
      .append('div')
      .attr('class', 'TopicBlock')
      .each(function (topic) { topic.DOM = d3.select(this); })
      .on('click', (topic) => { me.selectTopic(topic); });

    if (!exp_basis) {
      this.DOM.TopicBlock.append('span').attr('class', 'recentlyUsedIcon fa fa-history')
        .each(function () { this.tipsy = new Tipsy(this, { gravity: 'ne', title: 'Recently used' }); })
        .on('mouseenter', function () { this.tipsy.show(); })
        .on('mouseleave', function () { this.tipsy.hide(); });
    }

    this.DOM.TopicBlock.append('div').attr('class', 'TopicIcons')
      .selectAll('.icon').data(d => d.actions.concat(d.topics))
      .enter()
      .append('span')
      .attr('class', d => me.getIcon(d, 'icon'))
      .attr('title', d => d);

    if (!exp_basis) {
      this.DOM.TopicBlock.append('div').attr('class', 'notInContext fa fa-exclamation-circle')
        .each(function () { this.tipsy = new Tipsy(this, { gravity: 'nw', title: 'Not applicable' }); })
        .on('mouseenter', function () { this.tipsy.show(); })
        .on('mouseleave', function () { this.tipsy.hide(); });
    }

    this.DOM.TopicText = this.DOM.TopicBlock.append('div').attr('class', 'TopicText');
  },
  /** -- */
  fHighlightBox(text, pos, className, skipStencil, moreClass) {
    const me = this;
    const bounds_browser = this.browser.DOM.root.node().getBoundingClientRect();

    kshf.activeTipsy = null;

    if (pos === undefined) pos = 'w';
    if (typeof text === 'function') text = text.call(this.context);
    if (moreClass === undefined) moreClass = '';

    this.DOM.overlay_answer.selectAll('.stencilBox_nomatch')
      .data(this.context.HighlightedDOM, (d, i) => d, i)
      .enter()
      .append('div')
      .attr('class', `stencilBox ${moreClass}`)
      .each(function (d) {
        if (skipStencil) this.skipStencil = true;
        d.stencilBox = d3.select(this);
        this.bounds = d.getBoundingClientRect();
        this.left = this.bounds.left - bounds_browser.left - 3;
        this.width = this.bounds.width + 6;
        this.top = this.bounds.top - bounds_browser.top - 3;
        this.height = this.bounds.height + 6;
      })
      .style('left', function () { return `${this.left}px`; })
      .style('width', function () { return `${this.width}px`; })
      .style('top', function () { return `${this.top}px`; })
      .style('height', function () { return `${this.height}px`; })
      .each(function (d, i) {
        if (i !== 0) return; // show tip only for the first one
        // TODO: Pick up based on screen location (avoid edges) or other relevant metrics.
        this.tipsy = new Tipsy(this, {
          gravity: pos,
          title: text,
          className: `tipsy-helpin ${className || ''}`,
        });
        me.tooltips.push(this.tipsy);
        this.tipsy.show();
      })
      // TODO: event might not be click, might be a custom handler / function call, or other type of DOM event
      .on('click.close', (boxDOM) => {
        boxDOM.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
        const seq = me.selectedTopic.tAnswer[0].sequence;
        if (seq && seq.length > me.answerSequencePos + 1) {
          me.removeTooltips();
          // the click event may trigger animation. wait a while
          setTimeout(() => {
            me.context_highlight(seq[++me.answerSequencePos]);
            me.createStencils();
          }, 700);
          return;
        }
        me.closePanel();
      });

    this.repositionHelpMenu();
    this.createStencils();
  },
  /** -- */
  showHelpPanel() {
    if (this.panelShown) return;
    this.panelShown = true;
    if (!this.helpOnKey) this.DOM.overlay_control.classed('expanded', 'true');
  },
  /** -- */
  closePanel() {
    const me = this;
    this.panelShown = false;

    this.removeTooltips();
    this.closeTopic();
    this.browser.panel_overlay.attr('show', 'none');
    this.DOM.overlay_answer.on('mousemove.helpin', null).on('click.helpin', null);
    this.removeStencilBoxes();
    this.browser.DOM.kshfBackground.style('-webkit-mask-image', null);
  },
  /** -- */
  removeTooltips() {
    this.browser.DOM.root.selectAll('.tipsy').remove();
    kshf.activeTipsy = null;
    this.tooltips.forEach((t) => { t.hide(); });
    this.tooltips = [];
  },
  /** -- */
  closeTopic() {
    if (this.selectedTopic === null) return;

    this.browser.panel_overlay.attr('topicAnswer', null);
    this.browser.DOM.kshfBackground.style('-webkit-mask-image', null);

    this.DOM.SelectedThing_Content.selectAll('div').data([]).exit().remove();

    if (this.selectedTopic.isRelevant && !exp_basis) {
      this.removeTooltips();
      this.removeStencilBoxes();
      this.clearAnimations();
      if (this.context.HighlightedDOM_All.length > 0) {
        this.context.HighlightedDOM_All.forEach((DOM) => { DOM.removeAttribute('helpin'); });
      }
      if (this.selectedTopic.deactivate) {
        this.selectedTopic.deactivate.call(this, this.selectedTopic);
      }
      this.selectedTopic.tAnswer.forEach(function (answer) {
        if (answer.deactivate) answer.deactivate.call(this);
      }, this);
    }

    this.selectedTopic = null;
  },
  /** -- */
  sortTopicsByRelevance() {
    if (exp_basis) {
      const me = this;
      this.topicsList = this.topicsList.sort((a, b) => {
        const _a = me.getTopicTitle(a);
        const _b = me.getTopicTitle(b);
        return _a.localeCompare(_b);
      });
    } else {
      // sort by relevance
      this.topicsList = this.topicsList.sort((a, b) => {
        if (a.isRelevant && !b.isRelevant) return -1;
        if (b.isRelevant && !a.isRelevant) return 1;
        const x = b.relevanceWeight - a.relevanceWeight;
        if (x) return x;
        return b.id.localeCompare(a.id); // same weight, make sure sort is stable
      });
    }
    // reorder topics list dom
    this.DOM.TopicBlock.data(this.topicsList, d => d.id).order();
  },
  /** -- */
  refreshTopicsOutOfContext() {
    this.DOM.TopicBlock.attr('outOfContext', topic => (topic.isRelevant ? null : 'true'));
  },
  /** -- */
  filterTopics() {
    const me = this;

    // evaluate context
    this.topicsList.forEach(function (topic) { this.evaluateContext(topic); }, this);
    // refresh topic text
    this.DOM.TopicText.html(topic => me.getTopicTitle(topic));
    // refresh recently used icon
    this.DOM.TopicBlock.selectAll('.recentlyUsedIcon')
      .style('display', topic => (topic.usedPos === -1 ? 'none' : 'block'))
      .style('opacity', (topic) => {
        const l = me.topicHistory.length * 1.0;
        return 0.2 + 0.8 * (l - topic.usedPos) * (1 / l);
      });

    this.sortTopicsByRelevance();
    this.refreshTopicsOutOfContext();

    // refresh display
    this.topicsList.forEach(function (topic) {
      topic.displayed = true;
      // No answer defined yet
      if (topic.activate === undefined && topic.tAnswer.length === 0) {
        topic.DOM.style('color', 'gray');
      }
      // Filter for selected actions
      if (topic.displayed && this.qFilters.actions.length > 0) {
        topic.displayed = this.qFilters.actions.every(selected => topic.actions.some(actionName => actionName === selected.name));
      }
      // Filter for selected components
      if (topic.displayed && this.qFilters.topics.length > 0) {
        topic.displayed = this.qFilters.topics.every(selected => topic.topics.some(topicName => topicName === selected.name));
      }
      // Filter on text search
      if (topic.displayed && this.qFilters.textSearch !== '') {
        topic.displayed = this.getTopicTitle(topic).toLowerCase().indexOf(this.qFilters.textSearch) !== -1;
      }
      if (this.filterRelevantOnly() && !topic.isRelevant) {
        topic.displayed = false;
      }
      // Done
      topic.DOM.style('display', topic.displayed ? null : 'none');
    }, this);

    this.updateTopicKeys();
  },
  updateTopicKeys() {
    this.actionsList.forEach((action) => {
      action.activeQ = 0;
      action.questions.forEach((q) => { action.activeQ += q.displayed; });
    });
    this.keywordsList.forEach((topic) => {
      topic.activeQ = 0;
      topic.questions.forEach((q) => { topic.activeQ += q.displayed; });
    });

    this.actionsList = this.actionsList.sort((action1, action2) => {
      if (action2.selected) return 1;
      if (action1.selected) return -1;
      const x = action2.activeQ - action1.activeQ;
      if (x) return x;
      return action2.name.localeCompare(action1.name);
    });

    this.DOM.ActionSelect.data(this.actionsList, action => action.name).order()
      .attr('noTopics', action => (action.activeQ > 0 ? null : 'none'));
    this.DOM.ActionSelect.selectAll('.num').html(action => action.activeQ);

    this.keywordsList = this.keywordsList.sort((topic1, topic2) => {
      if (topic2.selected) return 1;
      if (topic1.selected) return -1;
      const x = topic2.activeQ - topic1.activeQ;
      if (x) return x;
      return topic2.name.localeCompare(topic1.name);
    });
    this.DOM.TopicSelect.data(this.keywordsList, topic => topic.name).order()
      .attr('noTopics', topic => (topic.activeQ > 0 ? null : 'none'));
    this.DOM.TopicSelect.selectAll('.num').html(topic => topic.activeQ);
  },
  /** -- */
  getKshfDOMTree(pointedElement) {
    const pointedDOMTree = [pointedElement];
    while (true) {
      if (pointedElement.parentNode === undefined) break;
      if (pointedElement.parentNode.matches === undefined) break;
      if (pointedElement.parentNode.matches('.kshf')) break;
      pointedDOMTree.push(pointedElement.parentNode);
      pointedElement = pointedElement.parentNode;
    }
    return pointedDOMTree;
  },
  /** -- */
  learnAboutPointed(pointedDOM, traverse) {
    const me = this;
    if (traverse === undefined) traverse = true;

    if (this.selectedTopic) this.closeTopic();

    this.DOM.TopicBlock.style('display', 'none');

    this.DOM.SelectedThing_Content_More.html('').style('display', 'none');

    // EXTRACT POINTED FULL DOM TREE
    let pointedDOMTree = traverse ? this.getKshfDOMTree(pointedDOM) : [pointedDOM];

    // evaluate context to reset relevanceWeight
    this.topicsList.forEach(function (topic) {
      topic.mostSpecific = false;
      this.evaluateContext(topic);
    }, this);

    // Display related topics using topicsByDOMSelector on the complete DOM tree
    pointedDOMTree.forEach(function (dom, i) {
      for (const selector in this.topicsByDOMSelector) {
        if (dom.matches(`.kshf ${selector}`)) {
          this.topicsByDOMSelector[selector].forEach((topic) => {
            topic.DOM.style('display', 'block');
            topic.relevanceWeight += 1000 * (pointedDOMTree.length - i);
            topic.mostSpecific = true;
          });
        }
      }
    }, this);

    // Filter DOM tree before you show the overlays. (to relevant ones)
    let infoPrinted = false;
    let titlePrinted = false;
    this.DOM.SelectedThing_Content.html('');
    // Filter out DOM elements that do not match any component.

    pointedDOMTree = pointedDOMTree.filter((dom, i) => {
      for (const component in _material._components) {
        if (dom.matches(_material._components[component].matches)) return true;
      }
      return false;
    });

    pointedDOMTree = pointedDOMTree.slice(0, 2);

    if (pointedDOMTree.length === 0) {
      this.DOM.SelectedThing_Header.select('.hContent')
        .html("<i class='fa fa-hand-pointer-o'></i> Point to your area of interest</div>");
      this.DOM.SelectedThing_Content.html('No component matches the pointed area');
      return;
    }

    this.theComponent = null;
    this.theComponent_DOM = null;

    // process each matching components to detect related topics and print title / description.
    pointedDOMTree.forEach(function (dom, i) {
      for (const componentName in _material._components) {
        const x = _material._components[componentName];
        if (!dom.matches(x.matches)) continue;
        dom.__temp__ = componentName;
        dom.tooltipPos = 'n';
        if (x.pos) dom.tooltipPos = x.pos;

        const keyword = this.keywordsIndexed[componentName];
        if (keyword) {
          keyword.questions.forEach(function (topic) {
            if (dom.__data__ instanceof kshf.SummaryBase) {
              this.evaluateContext(topic, dom.__data__); // pass the summary object for focused evaluation
            }
            topic.mostSpecific = topic.mostSpecific || i === 0;
            // prioritize topics about more specific components first.
            topic.relevanceWeight += 1000 * (pointedDOMTree.length - i);
            topic.DOM.style('display', 'block');
          }, this);
        }

        // Print title and description
        if (componentName && !titlePrinted) {
          this.DOM.SelectedThing_Header
            .select('.hContent').html(`<i class='fa fa-hand-pointer-o'></i> ${componentName}</div>`);
          this.theComponent = x;
          this.theComponent_DOM = dom;
        }
        if (x.info && !infoPrinted) {
          if (componentName) {
            this.DOM.SelectedThing_Header
              .select('.hContent').html(`<i class='fa fa-hand-pointer-o'></i> ${componentName}</div>`);
            titlePrinted = true;
          }
          this.DOM.SelectedThing_Content.html(x.info.call(this, dom));
          infoPrinted = true;
        }
      }
    }, this);

    this.DOM.TopicText.html(topic => me.getTopicTitle(topic));


    this.sortTopicsByRelevance();
    this.refreshTopicsOutOfContext();
    this.DOM.TopicBlock.style('font-size', (d) => {
      if (d.mostSpecific) return '0.9em';
    });

    // ADD DOM TREE BOXES

    pointedDOMTree.reverse();
    const bounds_browser = this.browser.DOM.root.node().getBoundingClientRect();

    const X = this.DOM.overlay_answer.selectAll('.stencilBox')
      .data(pointedDOMTree, (d, i) => i);

    X.enter().append('div').attr('class', 'stencilBox');

    X.exit().each(function () {
      if (this.tipsy) this.tipsy.hide();
      // TODO: remove from tooltips
    }).remove();

    X.each(function (d) {
      this.bounds = d.getBoundingClientRect();
      this.left = this.bounds.left - bounds_browser.left - 2;
      this.width = this.bounds.width + 4;
      this.top = this.bounds.top - bounds_browser.top - 2;
      this.height = this.bounds.height + 4;
    })
      .style('left', function () { return `${this.left}px`; })
      .style('width', function () { return `${this.width}px`; })
      .style('top', function () { return `${this.top}px`; })
      .style('height', function () { return `${this.height}px`; })
      .each(function (d, i) {
        this.skipStencil = (i !== 0);
        if (i === pointedDOMTree.length - 1) me.theStencil = this;
        // TODO: Pick up based on screen location (avoid edges) or other relevant metrics.
        let tipsyClass = 'tipsy-helpin';
        if (i === pointedDOMTree.length - 1) tipsyClass += ' tipsy-primary';
        if (this.tipsy === undefined) {
          this.tipsy = new Tipsy(this, { gravity: d.tooltipPos, title: d.__temp__, className: tipsyClass });
          this.tipsy.pointedDOM = d;
          me.tooltips.push(this.tipsy);
          kshf.activeTipsy = null;
          this.tipsy.show();
        } else {
          // recycle existing tipsy
          if (this.tipsy.pointedDOM !== d) {
            this.tipsy.options.title = d.__temp__;
            this.tipsy.options.className = tipsyClass;
            this.tipsy.options.gravity = d.tooltipPos;
            this.tipsy.jq_element = this;
            this.tipsy.pointedDOM = d;
            kshf.activeTipsy = null;
            this.tipsy.show();
          } else {
            this.tipsy.jq_tip.classed('tipsy-primary', (i === pointedDOMTree.length - 1) ? 'true' : null);
          }
        }

        this.tipsy.jq_tip.attr('locked', null);
        this.removeAttribute('locked');
      });

    this.createStencils();

    this.processThingContent();

    setTimeout(() => { me.repositionHelpMenu(); }, 1000);
  },
  /** -- */
  dynamicPointed() {
    this.DOM.overlay_answer.style('pointer-events', 'none');
    this.browser.panel_overlay.style('pointer-events', 'none');
    this.browser.DOM.kshfBackground.style('pointer-events', 'none');

    this.learnAboutPointed(document.elementFromPoint(d3.event.clientX, d3.event.clientY));

    // unroll pointer-event pass style - end of mousemove event
    this.DOM.overlay_answer.style('pointer-events', null);
    this.browser.panel_overlay.style('pointer-events', null);
    this.browser.DOM.kshfBackground.style('pointer-events', null);
  },
  /** -- */
  showOverlayOnly() {
    const me = this;
    this.initDOM();
    this.showHelpPanel();
    this.browser.panel_overlay.attr('show', 'help-overlayonly').attr('lockedPointNLearn', null);
    this.DOM.overlay_control.selectAll('[class^="helpInMode_"]').attr('active', null);
  },
  /** -- */
  showPointNLearn() {
    const me = this;
    this.initDOM();
    this.showHelpPanel();

    if (this.selectedTopic) this.closeTopic();

    this.browser.panel_overlay.attr('show', 'help-pointnlearn').attr('lockedPointNLearn', null);

    this.DOM.overlay_control.selectAll('[class^="helpInMode_"]').attr('active', null);
    this.DOM.overlay_control.select('.helpInMode_PointNLearn').attr('active', true);

    this.DOM.root
      .styles({ left: null, right: null, top: null, bottom: null })
      .attr('hideRelatedTopics', true);
    this.DOM.TopicBlock.style('display', 'none');

    this.lockedBox = false;

    this.DOM.SelectedThing_Header
      .select('.hContent').html("<i class='fa fa-hand-pointer-o'></i> Point to your area of interest</div>");
    this.DOM.SelectedThing_Content.html('');

    this.DOM.overlay_answer
      .on('click.helpin', () => {
        if (me.browser.panel_overlay.attr('show') !== 'help-pointnlearn') return;
        if (me.lockedBox) {
          me.unfreezePointed();
          me.dynamicPointed();
        } else {
          me.freezePointed(d3.event.target);
        }
        d3.event.stopPropagation();
        d3.event.preventDefault();
      })
      .on('mousemove.helpin', () => {
        if (me.lockedBox || me.movingBox) return;
        d3.event.stopPropagation();
        d3.event.preventDefault();
        me.dynamicPointed();
      });
  },
  /** -- */
  freezePointed(target) {
    this.lockedBox = target;
    this.lockedBox.setAttribute('locked', true);
    if (this.lockedBox.tipsy) this.lockedBox.tipsy.jq_tip.attr('locked', true);
    this.DOM.root.attr('hideRelatedTopics', null);
    this.browser.panel_overlay.attr('lockedPointNLearn', true);

    if (this.theComponent.onLock) this.theComponent.onLock.call(this, this.lockedBox.__data__);
    this.checkBoxBoundaries();
  },
  /** -- */
  unfreezePointed() {
    this.lockedBox.removeAttribute('locked');
    if (this.lockedBox.tipsy) this.lockedBox.tipsy.jq_tip.attr('locked', null);
    this.DOM.root.attr('hideRelatedTopics', true);
    this.browser.panel_overlay.attr('lockedPointNLearn', null);

    const component = _material._components[this.lockedBox.__data__.__temp__];
    if (component.onUnlock) {
      component.onUnlock.call(this, this.lockedBox.__data__);
      this.createStencils();
    }
    this.lockedBox = false;
  },
  /** -- */
  closePointNLearn() {
    this.removeTooltips();
    this.removeStencilBoxes();
    this.DOM.overlay_answer.on('mousemove.helpin', null).on('mousemove.click', null);
    this.browser.DOM.kshfBackground.style('-webkit-mask-image', null);
  },
  /** -- */
  prepareGuidedTourSeq() {
    this.GuidedTourSeq = [];

    // if a guide is topic, do not need to define context, topic defines its own context

    this.GuidedTourSeq = [];
    _material._guideSteps.forEach(function (g) {
      if (g.component) {
        const x = _material._components[g.component];
        const m = this.browser.DOM.root.select(x.matches);
        if (m.node() !== null) {
          this.GuidedTourSeq.push({ dom: m.node() });
        }
      } else if (g.topic !== undefined) {
        const _t = _material._topics[g.topic];
        this.evaluateContext(_t);
        // evaluate on context
        if (_t.isRelevant) {
          this.GuidedTourSeq.push({ topic: _t });
        }
      }
    }, this);
  },
  /** -- */
  showGuidedTour() {
    const me = this;

    this.initDOM();
    this.showHelpPanel();

    if (this.selectedTopic) this.closeTopic();

    this.browser.panel_overlay.attr('show', 'help-guidedtour');

    this.DOM.overlay_control.selectAll('[class^="helpInMode_"]').attr('active', null);
    this.DOM.overlay_control.select('.helpInMode_GuidedTour').attr('active', true);

    this.DOM.root.styles({ left: null, right: null, top: null, bottom: null });
    this.DOM.root.attr('hideRelatedTopics', true);
    this.DOM.TopicBlock.style('display', 'none');

    this.prepareGuidedTourSeq();

    this.DOM.GuidedTourProgressBar.selectAll('.GuidedTourOneStep')
      .data(new Array(this.GuidedTourSeq.length))
      .enter()
      .append('span')
      .attr('class', 'GuidedTourStep GuidedTourOneStep')
      .style('width', (d, i) => `${i * (100 / (me.GuidedTourSeq.length - 1))}%`)
      //        .each(function(){ this.tipsy = new Tipsy(this, { gravity: 'ne', title: "Go back" }); })
      //        .on("mouseenter", function(){ this.tipsy.show(); })
      //        .on("mouseleave", function(){ this.tipsy.hide(); })
      .on('click', (d, i) => {
        me.GuidedTourStep = i;
        me.showTourStep();
      });

    this.showTourStep();
  },
  /** -- */
  showResponse(response) {
    if (this.theComponent) {
      if (this.theComponent.onUnlock) {
        this.theComponent.onUnlock.call(this, this.theComponent_DOM);
      }
    }
    if (response.dom) {
      this.learnAboutPointed(response.dom, false/* don't traverse dom */);
      if (this.theComponent.onLock) {
        this.theComponent.onLock.call(this, response.dom);
      }
    } else if (response.topic) {
      this.selectTopic(response.topic);
    }
  },
  /** -- */
  showTourStep() {
    this.showResponse(this.GuidedTourSeq[this.GuidedTourStep]);

    this.DOM.root.select('.TourStep.PreviousStep')
      .style('display', (this.GuidedTourStep === 0) ? 'none' : null);
    this.DOM.root.select('.TourStep.NextStep')
      .style('display', (this.GuidedTourStep === this.GuidedTourSeq.length - 1) ? 'none' : null);
    this.DOM.GuidedTourCurrentStep.style('width', `${(this.GuidedTourStep / (this.GuidedTourSeq.length - 1)) * 100}%`);
  },
  /** -- */
  showTourStep_Prev() {
    if (this.GuidedTourStep === 0) return;
    --this.GuidedTourStep;
    this.showTourStep();
  },
  /** -- */
  showTourStep_Next() {
    if (this.GuidedTourStep === this.GuidedTourSeq.length - 1) return;
    ++this.GuidedTourStep;
    this.showTourStep();
  },
  /** -- */
  repositionHelpMenu() {
    const margin = 40;
    const bounds_browser = this.browser.DOM.root.node().getBoundingClientRect();
    const rootDOM = this.DOM.root.node();

    const initLeft = rootDOM.offsetLeft; // position relative to parent
    const initTop = rootDOM.offsetTop; // position relative to parent
    const boxWidth = rootDOM.getBoundingClientRect().width;
    const boxHeight = rootDOM.getBoundingClientRect().height;
    const browserWidth = bounds_browser.width;
    const browserHeight = bounds_browser.height;
    const maxLeft = browserWidth - margin - boxWidth;
    const maxTop = browserHeight - margin - boxHeight;

    const x = rootDOM.getBoundingClientRect();
    const helpBox = {
      left: x.left - bounds_browser.left,
      right: x.right - bounds_browser.left,
      top: x.top - bounds_browser.top,
      bottom: x.bottom - bounds_browser.top,
    };

    let bestPos = null;
    let bestIntSize = browserHeight * browserWidth * 100;

    const boxes = [];
    // add stencil boxes to avoid
    this.DOM.overlay_answer.selectAll('.stencilBox').each(function () {
      boxes.push({ left: this.left, top: this.top, right: this.left + this.width, bottom: this.top + this.height });
    });
    // add tooltip boxes to avoid
    browser.DOM.root.selectAll('.tipsy').each(function () {
      const bounds = this.getBoundingClientRect();
      const left = bounds.left - bounds_browser.left - 2;
      const width = bounds.width + 4;
      const top = bounds.top - bounds_browser.top - 2;
      const height = bounds.height + 4;
      boxes.push({ left, top, right: left + width, bottom: top + height });
    });

    [ // Current position
      { left: initLeft, top: initTop },
      // Middle top
      { left: (browserWidth - boxWidth) / 2, top: 60 },
      // top right corner
      { left: maxLeft, top: margin },
      // bottom right corner
      { left: maxLeft, top: maxTop },
      // bottom left corner
      { left: margin, top: maxTop },
      // top left corner
      { left: margin, top: margin },
    ].some(function (pos, i) {
      pos.right = pos.left + boxWidth;
      pos.bottom = pos.top + boxHeight;
      // Compute the total intersection size of the help box with highlight boxes
      let curIntSize = 0;

      // TODO
      boxes.forEach((box) => {
        const x_overlap = Math.max(0, Math.min(pos.right, box.right) - Math.max(pos.left, box.left));
        const y_overlap = Math.max(0, Math.min(pos.bottom, box.bottom) - Math.max(pos.top, box.top));
        curIntSize += x_overlap * y_overlap;
      }, this);

      // if this new position intersects less, use this position
      if (curIntSize < bestIntSize) {
        bestPos = pos;
        bestIntSize = curIntSize;
      }
      return curIntSize === 0; // stop traversal if we reached 0-intersection
    });

    // use the best position
    if (bestPos === null) return;
    this.DOM.root.node().style.left = `${Math.min(maxLeft, Math.max(0, bestPos.left))}px`;
    this.DOM.root.node().style.top = `${Math.min(maxTop, Math.max(0, bestPos.top))}px`;
  },
  /** --*/
  checkBoxBoundaries() {
    const margin = 10;
    const bounds_browser = this.browser.DOM.root.node().getBoundingClientRect();
    const rootDOM = this.DOM.root.node();

    const initLeft = rootDOM.offsetLeft; // position relative to parent
    const initTop = rootDOM.offsetTop; // position relative to parent
    const boxWidth = rootDOM.getBoundingClientRect().width;
    const boxHeight = rootDOM.getBoundingClientRect().height;
    const browserWidth = bounds_browser.width;
    const browserHeight = bounds_browser.height;
    const maxLeft = browserWidth - margin - boxWidth;
    const maxTop = browserHeight - margin - boxHeight;

    // use the best position
    rootDOM.style.left = `${Math.min(maxLeft, Math.max(0, initLeft))}px`;
    rootDOM.style.top = `${Math.min(maxTop, Math.max(0, initTop))}px`;
  },
  /** -- */
  showNotification() {
    this.initDOM();
    // apply
    this.showTopicListing();
    this.showResponse(this.notifyAction);
    this.clearNotification();
  },
  /** -- */
  clearNotification() {
    this.browser.DOM.notifyButton.style('display', 'none');
  },
};

export default Helpin;
