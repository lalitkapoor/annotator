// Selection and range creation reference for the following code:
// http://www.quirksmode.org/dom/range_intro.html
//
// I've removed any support for IE TextRange (see commit d7085bf2 for code)
// for the moment, having no means of testing it.

;(function($){

this.Annotator = DelegatorClass.extend({
  events: {
    '-adder mousedown': 'adderMousedown',
    '-highlighter mouseover': 'highlightMouseover',
    '-highlighter mouseout': 'startViewerHideTimer',
    '-viewer mouseover': 'viewerMouseover',
    '-viewer mouseout': 'startViewerHideTimer',
    '-controls .edit click': 'controlEditClick',
    '-controls .del click': 'controlDeleteClick'
  },

  options: {
    // Class used to identify elements owned/created by the annotator.
    classPrefix: 'annot',

    adder:       "<div><a href='#'></a></div>",
    editor:      "<div><textarea></textarea></div>",
    highlighter: "<span></span>",
    viewer:      "<div></div>"
  },

  init: function (options, element) {
    var self = this

    this.options = $.extend(this.options, options)

    this.element = element
    this.dom = {}

    $(this.element).wrapInner('<div class="' + this.getComponentClassname('wrapper') + '" />')
    this.wrapper = $(this.element).find('.' + this.getComponentClassname('wrapper')).get(0)

    this.addDelegatedEvent(this.element, 'mouseup', 'checkForEndSelection')
    this.addDelegatedEvent(this.element, 'mousedown', 'checkForStartSelection')

    // For all events beginning with '-', map them to a meaningful selector.
    // e.g. '-adder click' -> '.annot-adder click'
    $.each(this.events, function (k, v) {
      if (k.substr(0, 1) === '-') {
        self.events['.' + self.options.classPrefix + k] = v
        delete self.events[k]
      }
    })

    // Bind delegated events.
    this._super()

    $.each(['adder', 'editor', 'highlighter', 'viewer'], function (idx, name) {
      self.dom[name] = $(self.options[name]).attr({
        'class': self.getComponentClassname(name)
      }).appendTo(self.wrapper).hide()
    })
  },

  checkForStartSelection: function (e) {
    this.startViewerHideTimer()
    this.mouseIsDown = true
  },

  checkForEndSelection: function (e) {
    this.mouseIsDown = false

    // This prevents the note image from jumping away on the mouseup
    // of a click on icon.
    if (this.ignoreMouseup) {
      this.ignoreMouseup = false
      return
    }

    this.getSelection()

    var s = this.selection,
        validSelection = s && s.rangeCount > 0 && !s.isCollapsed

    if (e && validSelection) {
      this.dom.adder.css(this._mousePosition(e)).show()
    } else {
      this.dom.adder.hide()
    }
  },

  getSelection: function () {
    // TODO: fail gracefully in IE.
    this.selection = window.getSelection()
    this.selectedRanges = []
    for(var ii = 0; ii < this.selection.rangeCount; ii += 1) {
      this.selectedRanges.push(this.selection.getRangeAt(ii))
    }
  },

  createAnnotation: function (annotation) {
    var annotator = this

    annotation = annotation || {}
    annotation.highlights = annotation.highlights || []

    annotation.ranges = $.map(annotation.ranges || this.selectedRanges, function (r) {
      var normed, serialized

      if ("commonAncestorContainer" in r) {
        // range from a browser
        normed = annotator.normRange(r)
        serialized = annotator.serializeRange(normed)
      } else if (("start" in r) && (typeof r.start == "string")) {
        // serialized range
        normed = annotator.deserializeRange(r)
        serialized = r
      } else {
        // presume normed
        normed = r
        serialized = annotator.serializeRange(normed)
      }

      annotation.highlights = annotation.highlights.concat(annotator.highlightRange(normed))

      return serialized
    })

    // Save the annotation data on each highlighter element.
    $(annotation.highlights).data('annotation', annotation)
    // Fire annotationCreated event so that others can react to it.
    $(this.element).trigger('annotationCreated', [annotation])

    return annotation
  },

  deleteAnnotation: function (annotation) {
    $.each(annotation.highlights, function () {
      $(this).replaceWith($(this)[0].childNodes)
    })
    $(this.element).trigger('annotationDeleted', [annotation])
  },

  updateAnnotation: function (annotation, data) {
    $.extend(annotation, data)
    $(this.element).trigger('annotationUpdated', [annotation])
  },

  loadAnnotations: function (annotations, callback) {
    callback = callback || function () {}

    var self = this,
        results = []

    var loader = function (annList) {
      now = annList.splice(0, 10)

      $.each(now, function () {
        results.push(self.createAnnotation(this))
      })

      // If there are more to do, do them after a 100ms break (for browser
      // responsiveness).
      if (annList.length > 0) {
        setTimeout(function () { loader(annList) }, 100)
      } else {
        callback(results)
      }
    }

    loader(annotations)
  },

  // normRange: works around the fact that browsers don't generate
  // ranges/selections in a consistent manner. Some (Safari) will create
  // ranges that have (say) a textNode startContainer and elementNode
  // endContainer. Others (Firefox) seem to only ever generate
  // textNode/textNode or elementNode/elementNode pairs.
  //
  // This will return a (start, end, commonAncestor) triple, where start and
  // end are textNodes, and commonAncestor is an elementNode.
  //
  // NB: This method may well split textnodes (i.e. alter the DOM) to
  // achieve this.
  normRange: function (range) {
    var r = {}, nr = {}

    $.each(['start', 'end'], function (idx, p) {
      var it, node = range[p + 'Container'], offset = range[p + 'Offset']

      if(node.nodeType === Node.ELEMENT_NODE) {
        // Get specified node.
        it = node.childNodes[offset]
        // If it doesn't exist, that means we need the end of the
        // previous one.
        node = it || node.childNodes[offset - 1]
        while(node.nodeType !== Node.TEXT_NODE) { node = node.firstChild }
        offset = it ? 0 : node.nodeValue.length
      }

      r[p] = node
      r[p + 'Offset'] = offset
    })

    nr.start = (r.startOffset > 0) ? r.start.splitText(r.startOffset) : r.start

    if (r.start === r.end) {
      if ((r.endOffset - r.startOffset) < nr.start.nodeValue.length) {
        nr.start.splitText(r.endOffset - r.startOffset)
      }
      nr.end = nr.start
    } else {
      if (r.endOffset < r.end.nodeValue.length) {
        r.end.splitText(r.endOffset)
      }
      nr.end = r.end
    }

    // Make sure the common ancestor is an element node.
    nr.commonAncestor = range.commonAncestorContainer
    while(nr.commonAncestor.nodeType !== Node.ELEMENT_NODE) {
      nr.commonAncestor = nr.commonAncestor.parentNode
    }

    return nr
  },

  // serializeRange: takes a normedRange and turns it into a
  // serializedRange, which is two pairs of (xpath, character offset), which
  // can be easily stored in a database and loaded through
  // #loadAnnotations/#deserializeRange.
  serializeRange: function (normedRange) {
    var self = this

    var serialization = function (node, isEnd) {
      var origParent = $(node).parents(':not(.' + self.getComponentClassname('highlighter') + ')').eq(0),
          xpath = origParent.xpath(self.wrapper)[0],
          textNodes = origParent.textNodes(),

      // Calculate real offset as the combined length of all the
      // preceding textNode siblings. We include the length of the
      // node if it's the end node.
      offset = $.inject(
                 textNodes.slice(0, textNodes.index(node)),
                 0,
                 function (acc, tn) { return acc + tn.nodeValue.length }
               )

      return isEnd ? [xpath, offset + node.nodeValue.length] : [xpath, offset]
    },

    start = serialization(normedRange.start),
    end   = serialization(normedRange.end, true)

    return {
      // XPath strings
      start: start[0],
      end: end[0],
      // Character offsets (integer)
      startOffset: start[1],
      endOffset: end[1]
    }
  },

  deserializeRange: function (serializedRange) {
    var nodeFromXPath = function (xpath) {
      return document.evaluate( xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
    }

    var parentXPath = $(this.wrapper).xpath()[0],
        startAncestry = serializedRange.start.split("/"),
        endAncestry   = serializedRange.end.split("/"),
        common = [],
        range = {}

    // Crudely find a near common ancestor by walking down the XPath from
    // the root until the segments no longer match.
    for (var ii = 0; ii < startAncestry.length; ii += 1) {
      if (startAncestry[ii] === endAncestry[ii]) {
        common.push(startAncestry[ii])
      } else {
        break
      }
    }

    var cacXPath = parentXPath + common.join("/")
    range.commonAncestorContainer = nodeFromXPath(cacXPath)

    if (!range.commonAncestorContainer) {
      console.error("Error deserializing range: can't find XPath '" + cacXPath + "'. Is this the right document?")
    }

    // Unfortunately, we *can't* guarantee only one textNode per
    // elementNode, so we have to walk along the element's textNodes until
    // the combined length of the textNodes to that point exceeds or
    // matches the value of the offset.
    $.each(['start', 'end'], function () {
      var self = this, length = 0
      $(nodeFromXPath(parentXPath + serializedRange[this])).textNodes().each(function () {
        if (length + this.nodeValue.length >= serializedRange[self + 'Offset']) {
          range[self + 'Container'] = this
          range[self + 'Offset'] = serializedRange[self + 'Offset'] - length
          return false // end each loop.
        } else {
          length += this.nodeValue.length
          return true
        }
      })
    })

    return this.normRange(range)
  },

  highlightRange: function (normedRange) {
    var self = this,
        textNodes = $(normedRange.commonAncestor).textNodes(),
        elemList = []

    textNodes.slice(
      textNodes.index(normedRange.start),
      textNodes.index(normedRange.end) + 1
    ).each(function () {
      var wrapper = self.dom.highlighter.clone().show()
      elemList.push($(this).wrap(wrapper).parent().get(0))
    })

    return elemList
  },

  showEditor: function (e, annotation) {
    var self = this

    if (annotation) {
      this.dom.editor.find('textarea').val(annotation.text)
    }

    this.dom.editor
      .css(this._mousePosition(e))
      .show()
    .find('textarea')
      .focus()
      .bind('keydown', function (e) {
        if (e.keyCode == 27) {
          // "Escape" key: abort.
          $(this).val('').unbind().parent().hide()

        } else if (e.keyCode == 13 && !e.shiftKey) {
          // If "return" was pressed without the shift key, we're done.
          $(this).unbind().parent().hide()
          if (annotation) {
            self.updateAnnotation(annotation, { text: $(this).val() })
          } else {
            self.createAnnotation({ text: $(this).val() })
          }
          $(this).val('')
        }
      })
      .bind('blur', function (e) {
        $(this).val('').unbind().parent().hide()
      })

    this.ignoreMouseup = true
  },

  showViewer: function (e, annotations) {
    var controlsHTML = '<span class="' + this.getComponentClassname('controls') + '">' +
                       '<a href="#" class="edit" alt="Edit" title="Edit this annotation">Edit</a>' +
                       '<a href="#" class="del" alt="X" title="Delete this annotation">Delete</a></span>'

    var viewerclone = this.dom.viewer.clone().empty()

    $.each(annotations, function (idx, annot) {
      // As well as filling the viewer element, we also copy the annotation
      // object from the highlight element to the <p> containing the note
      // and controls. This makes editing/deletion much easier.
      $('<p>' + annot.text + controlsHTML + '</p>')
        .appendTo(viewerclone)
        .data("annotation", annot)
    })

    viewerclone.css(this._mousePosition(e)).replaceAll(this.dom.viewer).show()

    $(this.element).trigger('annotationViewerShown', [viewerclone.get(0), annotations])

    this.dom.viewer = viewerclone
  },

  startViewerHideTimer: function (e) {
    // Don't do this if timer has already been set by another annotation.
    if (!this.viewerHideTimer) {
      // Allow 250ms for pointer to get from annotation to viewer to manipulate
      // annotations.
      this.viewerHideTimer = setTimeout(function (ann) { ann.dom.viewer.hide() }, 250, this)
    }
  },

  clearViewerHideTimer: function () {
    clearTimeout(this.viewerHideTimer)
    this.viewerHideTimer = false
  },

  highlightMouseover: function (e) {
    // Cancel any pending hiding of the viewer.
    this.clearViewerHideTimer()

    // Don't do anything if we're making a selection.
    if (this.mouseIsDown) { return false }

    var annotations = $(e.target)
      .parents('.' + this.getComponentClassname('highlighter'))
      .andSelf().map(function () { return $(this).data("annotation") })

    this.showViewer(e, annotations)
  },

  adderMousedown: function (e) {
    this.dom.adder.hide()
    this.showEditor(e)
    return false
  },

  viewerMouseover: function (e) {
    // Cancel any pending hiding of the viewer.
    this.clearViewerHideTimer()
  },

  controlEditClick: function (e) {
    var para = $(e.target).parents('p'),
      pos = this._fakePositionFromElement(this.dom.viewer)

    // Replace the viewer with the editor.
    this.dom.viewer.hide()
    this.showEditor(pos, para.data("annotation"))
    return false
  },

  controlDeleteClick: function (e) {
    var para = $(e.target).parents('p')

    // Delete highlight elements.
    this.deleteAnnotation(para.data("annotation"))

    // Remove from viewer and hide viewer if this was the only annotation displayed.
    para.remove()
    if (!this.dom.viewer.is(':parent')) {
      this.dom.viewer.hide()
    }
    return false
  },

  addPlugin: function (klass, options) {
    return new klass(options, this.element)
  },

  getComponentClassname: function (name) {
    return this.options.classPrefix + '-' + name
  },

  _mousePosition: function (e) {
    return {
      top:  e.pageY - $(this.wrapper).offset().top,
      left: e.pageX - $(this.wrapper).offset().left
    }
  },

  _fakePositionFromElement: function (elem) {
    return {
      pageY: $(elem).offset().top,
      pageX: $(elem).offset().left
    }
  }
})

Annotator.Plugins = {}

$.plugin('annotator', Annotator)

})(jQuery)
