import classNames from 'classnames'
import memoizeOne from 'memoize-one'
import React from 'react'

import { cancelTimeout, convertNumber2PX, defaultItemKey, getScrollViewContextNode, omit, requestTimeout } from '../../../utils'
import { IS_SCROLLING_DEBOUNCE_INTERVAL } from '../constants'
import ListMap from '../list-map'
import Preset, { type IProps } from '../preset'

interface IState {
  id: string
  instance: Waterfall
  isScrolling: boolean
  scrollDirection: 'forward' | 'backward'
  scrollOffset: number
  scrollUpdateWasRequested: boolean
  refreshCount: number
}

export default class Waterfall extends React.PureComponent<IProps, IState> {
  static defaultProps: IProps = {
    itemData: undefined,
    overscanDistance: 50,
    useIsScrolling: false,
    shouldResetStyleCacheOnItemSizeChange: true
  }

  itemMap: ListMap
  preset: Preset

  constructor (props: IProps) {
    super(props)

    this.preset = new Preset(
      props,
      this.refresh,
    )
    const id = this.props.id || this.preset.id
    this.preset.updateWrapper(id)
    this.itemMap = this.preset.itemMap

    this.state = {
      id,
      instance: this,
      isScrolling: false,
      scrollDirection: 'forward',
      scrollOffset:
        typeof this.props.initialScrollOffset === 'number'
          ? this.props.initialScrollOffset
          : 0,
      scrollUpdateWasRequested: false,
      refreshCount: 0,
    }
  }

  refresh = () => {
    if (process.env.FRAMEWORK === 'preact') {
      this.forceUpdate()
    } else {
      this.setState(({ refreshCount }) => ({
        refreshCount: ++refreshCount
      }))
    }
  }

  #outerRef = undefined

  #resetIsScrollingTimeoutId = null

  #callOnItemsRendered = memoizeOne((columnIndex, overscanStartIndex, overscanStopIndex) => this.props.onItemsRendered({
    columnIndex,
    overscanStartIndex,
    overscanStopIndex,
  }))

  #callOnScroll = memoizeOne((scrollDirection, scrollOffset, scrollUpdateWasRequested, detail) => this.props.onScroll({
    scrollDirection,
    scrollOffset,
    scrollUpdateWasRequested,
    detail
  } as any))

  #callPropsCallbacks (prevProps: any = {}, prevState: any = {}) {
    if (typeof this.props.onItemsRendered === 'function') {
      if (this.props.itemCount > 0) {
        if (prevProps && prevProps.itemCount !== this.props.itemCount) {
          for (let columnIndex = 0; columnIndex < this.preset.columns; columnIndex++) {
            const [overscanStartIndex, overscanStopIndex] = this.#getRangeToRender(columnIndex)
            this.#callOnItemsRendered(columnIndex, overscanStartIndex, overscanStopIndex)
          }
        }
      }
    }

    if (typeof this.props.onScroll === 'function') {
      if (!prevState ||
        prevState.scrollDirection !== this.state.scrollDirection ||
        prevState.scrollOffset !== this.state.scrollOffset ||
        prevState.scrollUpdateWasRequested !== this.state.scrollUpdateWasRequested
      ) {
        this.#callOnScroll(
          this.state.scrollDirection,
          this.state.scrollOffset,
          this.state.scrollUpdateWasRequested,
          this.preset.field
        )
      }
    }

    // setTimeout(() => {
    //   const [startIndex, stopIndex] = this.#getRangeToRender()
    //   for (let index = startIndex; index <= stopIndex; index++) {
    //     this.#getSizeUploadSync(index)
    //   }
    // }, 0)
  }

  // Lazily create and cache item styles while scrolling,
  // So that pure component sCU will prevent re-renders.
  // We maintain this cache, and pass a style prop rather than index,
  // So that List can clear cached styles and force item re-render if necessary.
  #getRangeToRender (columnIndex = 0) {
    return this.itemMap.getRangeToRender(
      this.state.scrollDirection,
      columnIndex,
      this.state.scrollOffset,
      this.state.isScrolling,
    )
  }

  #outerRefSetter = ref => {
    const {
      outerRef
    } = this.props
    this.#outerRef = ref

    if (typeof outerRef === 'function') {
      outerRef(ref)
    } else if (outerRef != null && typeof outerRef === 'object' && outerRef.hasOwnProperty('current')) {
      // @ts-ignore
      outerRef.current = ref
    }
  }

  #resetIsScrollingDebounced = () => {
    if (this.#resetIsScrollingTimeoutId !== null) {
      cancelTimeout(this.#resetIsScrollingTimeoutId)
    }

    this.#resetIsScrollingTimeoutId = requestTimeout(this.#resetIsScrolling, IS_SCROLLING_DEBOUNCE_INTERVAL)
  }

  #resetIsScrolling = () => {
    this.#resetIsScrollingTimeoutId = null
    this.setState({
      isScrolling: false
    }, () => {
      // Clear style cache after state update has been committed.
      // This way we don't break pure sCU for items that don't use isScrolling param.
      this.preset.getItemStyleCache(-1)
    })
  }

  #onScroll = event => {
    const {
      scrollHeight = this.itemMap.maxColumnSize,
      scrollWidth,
      scrollTop,
      scrollLeft
    } = event.currentTarget
    const clientHeight = this.preset.wrapperHeight
    const clientWidth = this.preset.wrapperWidth
    this.setState((prevState: IState) => {
      const diffOffset = this.preset.field.scrollTop - scrollTop
      if (prevState.scrollOffset === scrollTop || this.preset.isShaking(diffOffset)) {
        // Scroll position may have been updated by cDM/cDU,
        // In which case we don't need to trigger another render,
        // And we don't want to update state.isScrolling.
        return null
      }
      // FIXME preact 中使用时，该组件会出现触底滚动事件重复触发导致的抖动问题，后续修复
      // Prevent Safari's elastic scrolling from causing visual shaking when scrolling past bounds.
      const scrollOffset = Math.max(0, Math.min(scrollTop, scrollHeight - clientHeight))
      this.preset.field = {
        scrollHeight: this.itemMap.maxColumnSize,
        scrollWidth,
        scrollTop: scrollOffset,
        scrollLeft,
        clientHeight,
        clientWidth,
        diffOffset: this.preset.field.scrollTop - scrollOffset,
      }
      return {
        isScrolling: true,
        scrollDirection: prevState.scrollOffset < scrollOffset ? 'forward' : 'backward',
        scrollOffset,
        scrollUpdateWasRequested: false
      }
    }, this.#resetIsScrollingDebounced)
  }

  public scrollTo (scrollOffset = 0) {
    const { enhanced } = this.props
    scrollOffset = Math.max(0, scrollOffset)
    if (this.state.scrollOffset === scrollOffset) return

    if (enhanced) {
      const option: any = {
        animated: true,
        duration: 500
      }
      option.top = scrollOffset
      return getScrollViewContextNode(`#${this.state.id}`).then((node: any) => node.scrollTo(option))
    }

    this.setState((prevState: IState) => {
      if (prevState.scrollOffset === scrollOffset) {
        return null
      }

      return {
        scrollDirection: prevState.scrollOffset < scrollOffset ? 'forward' : 'backward',
        scrollOffset,
        scrollUpdateWasRequested: true
      }
    }, this.#resetIsScrollingDebounced)
  }

  public scrollToItem (index: number, align = 'auto') {
    const { itemCount } = this.props
    const { scrollOffset } = this.state
    index = Math.max(0, Math.min(index, itemCount - 1))
    this.scrollTo(this.itemMap.getOffsetForIndexAndAlignment(index, align, scrollOffset))
  }

  componentDidMount () {
    const { initialScrollOffset } = this.props

    if (typeof initialScrollOffset === 'number' && this.#outerRef != null) {
      this.#outerRef.scrollTop = initialScrollOffset
    }

    this.#callPropsCallbacks()
  }

  componentDidUpdate (prevProps: IProps, prevState: IState) {
    const { scrollOffset, scrollUpdateWasRequested } = this.state

    this.preset.update(this.props)

    if (scrollUpdateWasRequested && this.#outerRef != null) {
      this.#outerRef.scrollTop = scrollOffset
    }

    this.#callPropsCallbacks(prevProps, prevState)
  }

  componentWillUnmount () {
    if (this.#resetIsScrollingTimeoutId !== null) {
      cancelTimeout(this.#resetIsScrollingTimeoutId)
    }
  }

  getRenderItemNode (index: number, type: 'node' | 'placeholder' = 'node') {
    const { item, itemData, itemKey = defaultItemKey, useIsScrolling } = this.props
    const { id, isScrolling } = this.state
    const key = itemKey(index, itemData)

    if (type === 'placeholder') {
      return React.createElement<any>(this.preset.itemElement, {
        key,
        style: { display: 'none' }
      })
    }

    const style = this.preset.getItemStyle(index)
    return React.createElement<any>(this.preset.itemElement, {
      key,
      id: `${id}-${index}-wrapper`,
      style
    }, React.createElement(item, {
      id: `${id}-${index}`,
      data: itemData,
      index,
      isScrolling: useIsScrolling ? isScrolling : undefined
    }))
  }

  getRenderColumnNode (index: number) {
    const { itemCount } = this.props
    const { id } = this.state
    const columnProps: any = {
      key: `${id}-column-${index}`,
      id: `${id}-column-${index}`,
      style: {
        height: '100%',
        position: 'relative',
        width: convertNumber2PX(this.preset.columnWidth)
      }
    }

    const [startIndex, stopIndex] = this.#getRangeToRender(index)
    const items = []
    if (this.preset.isRelative) {
      const [itemIndex] = this.itemMap.getItemsInfoFromPosition(index, startIndex)
      const pre = convertNumber2PX(this.itemMap.getOffsetSize(itemIndex))
      items.push(
        React.createElement<any>(this.preset.itemElement, {
          key: `${id}-${index}-pre`,
          id: `${id}-${index}-pre`,
          style: {
            height: pre,
            width: '100%'
          }
        })
      )
    }
    const placeholderCount = this.preset.placeholderCount
    let restCount = itemCount - stopIndex
    restCount =  restCount > 0 ? restCount : 0
    const prevPlaceholder = startIndex < placeholderCount ? startIndex : placeholderCount
    const postPlaceholder = restCount < placeholderCount ? restCount : placeholderCount
    this.itemMap.updateItem((stopIndex + postPlaceholder) * this.preset.columns + index)
    for (let i = startIndex - prevPlaceholder; i <= stopIndex + postPlaceholder; i++) {
      const [itemIndex] = this.itemMap.getItemsInfoFromPosition(index, i)
      if (i < startIndex || i > stopIndex) {
        items.push(this.getRenderItemNode(itemIndex, 'placeholder'))
      } else {
        items.push(this.getRenderItemNode(itemIndex))
      }
    }
    return React.createElement(this.preset.innerElement, columnProps, items)
  }

  render () {
    const {
      className,
      style,
      height,
      width,
      enhanced = false,
      renderTop,
      renderBottom,
      ...rest
    } = omit(this.props, ['innerElementType', 'innerTagName', 'itemElementType', 'itemTagName', 'outerElementType', 'outerTagName', 'position'])
    const {
      id,
      isScrolling,
      scrollOffset,
      scrollUpdateWasRequested
    } = this.state

    const estimatedHeight = convertNumber2PX(this.itemMap.maxColumnSize)
    const outerProps: any = {
      ...rest,
      id,
      className: classNames(className, 'virtual-waterfall'),
      onScroll: this.#onScroll,
      ref: this.#outerRefSetter,
      enhanced,
      style: {
        height: convertNumber2PX(height),
        width: convertNumber2PX(width),
        overflow: 'auto',
        WebkitOverflowScrolling: 'touch',
        willChange: 'transform',
        ...style
      },
    }

    if (!enhanced) {
      outerProps.scrollTop = scrollUpdateWasRequested ? scrollOffset : this.preset.field.scrollTop
    }

    const columns = this.preset.columns
    const columnNodes: React.ReactNode[] = []
    for (let i = 0; i < columns; i++) {
      columnNodes.push(this.getRenderColumnNode(i))
    }

    return React.createElement(
      this.preset.outerElement,
      outerProps,
      renderTop,
      React.createElement(this.preset.innerElement, {
        key: `${id}-wrapper`,
        id: `${id}-wrapper`,
        className: classNames(className, 'virtual-waterfall-wrapper'),
        style: {
          display: 'flex',
          justifyContent: 'space-evenly',
          pointerEvents: isScrolling ? 'none' : 'auto',
          position: 'relative',
          height: estimatedHeight,
          width: '100%',
          ...style
        },
      } as any, columnNodes),
      renderBottom,
    )
  }
}
