import { Content, Portal, Root, Trigger } from "@kobalte/core/tooltip"
import {
  createContext,
  createEffect,
  Match,
  onCleanup,
  splitProps,
  Switch,
  untrack,
  useContext,
  type JSX,
  type ParentProps,
} from "solid-js"
import type { ComponentProps } from "solid-js"
import { createStore } from "solid-js/store"
import "./tooltip.css"

export interface TooltipProps extends ComponentProps<typeof Root> {
  value: JSX.Element
  appearance?: "standard" | "compact" | "large"
  class?: string
  contentClass?: string
  contentStyle?: JSX.CSSProperties
  inactive?: boolean
  forceOpen?: boolean
  triggerTabIndex?: number
}

const HANDOFF_MS = 300

export type TooltipGroupOwner = HTMLElement | string

function createTooltipGroup() {
  const [state, setState] = createStore<{ active?: TooltipGroupOwner; closed: number }>({ closed: 0 })
  const triggers = new Set<HTMLElement>()

  return {
    warm: (owner: TooltipGroupOwner | undefined) =>
      (state.active !== undefined && state.active !== owner) || Date.now() - state.closed < HANDOFF_MS,
    opened: (owner: TooltipGroupOwner | undefined) => setState("active", owner),
    closed: (owner: TooltipGroupOwner | undefined) => {
      if (state.active === owner) setState({ active: undefined, closed: Date.now() })
    },
    register: (trigger: HTMLElement) => {
      triggers.add(trigger)
      onCleanup(() => triggers.delete(trigger))
    },
    region: (trigger: HTMLElement) => {
      const others = [...triggers].filter((item) => item !== trigger)

      if (others.length === 0) return

      return container(trigger, others)
    },
  }
}

const TooltipGroupContext = createContext<ReturnType<typeof createTooltipGroup>>()

export function TooltipGroup(props: ParentProps) {
  return <TooltipGroupContext.Provider value={createTooltipGroup()}>{props.children}</TooltipGroupContext.Provider>
}

export function useTooltipGroup() {
  return useContext(TooltipGroupContext)
}

export function Tooltip(props: TooltipProps) {
  let ref: HTMLDivElement | undefined
  const group = useTooltipGroup()

  const [state, setState] = createStore({
    open: false,
    block: false,
    expand: false,
    instant: false,
  })

  const [local, others] = splitProps(props, [
    "children",
    "appearance",
    "class",
    "contentClass",
    "contentStyle",
    "inactive",
    "forceOpen",
    "triggerTabIndex",
    "ignoreSafeArea",
    "openDelay",
    "value",
  ])

  const close = () => {
    group?.closed(ref)
    setState("open", false)
  }

  const controlled = () => local.forceOpen !== undefined
  // Controlled closes bypass Kobalte's own skip-delay timer, so the group decides the handoff delay.
  const openDelay = () => (group?.warm(ref) ? 0 : (local.openDelay ?? 400))

  const inside = () => {
    const active = document.activeElement

    if (!ref || !active) return false

    return ref.contains(active)
  }

  const drop = (expand = state.expand) => {
    if (expand || !state.block) return

    if (ref?.matches(":hover")) return

    if (inside()) return
    setState("block", false)
  }

  const sync = () => {
    const expand = !!ref?.querySelector('[aria-expanded="true"], [data-expanded]')
    setState("expand", expand)

    if (expand) {
      setState("block", true)
      close()

      return
    }

    drop(expand)
  }

  const arm = () => {
    setState("block", true)
    close()
  }

  const leave = (event: PointerEvent) => {
    if (!inside()) {
      // Kobalte calls this before its own close, so the exit animation is chosen here.
      const target = event.relatedTarget
      const region = group && ref ? group.region(ref) : undefined
      setState("instant", target instanceof Node && !!region?.contains(target))
      close()
    }

    drop()
  }

  createEffect(() => {
    const trigger = ref

    if (!trigger) return
    group?.register(trigger)
    untrack(sync)
    const obs = new MutationObserver(sync)
    obs.observe(trigger, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-expanded", "data-expanded"],
    })
    onCleanup(() => {
      obs.disconnect()
      group?.closed(trigger)
    })
  })

  let justClickedTrigger = false

  return (
    <Switch>
      <Match when={local.inactive}>{local.children}</Match>
      <Match when={true}>
        <Root
          gutter={4}
          skipDelayDuration={300}
          {...others}
          openDelay={openDelay()}
          closeDelay={0}
          ignoreSafeArea={local.ignoreSafeArea ?? true}
          open={controlled() ? local.forceOpen : state.open}
          onOpenChange={(open) => {
            if (controlled()) return

            if (state.block && open) return

            if (justClickedTrigger) {
              justClickedTrigger = false

              return
            }

            if (!open) {
              close()

              return
            }

            setState("instant", !!group?.warm(ref))
            group?.opened(ref)
            setState("open", true)
          }}
        >
          <Trigger
            ref={ref}
            as="div"
            tabIndex={local.triggerTabIndex}
            data-component="tooltip-v2-trigger"
            class={local.class}
            onPointerDownCapture={arm}
            onKeyDownCapture={(event: KeyboardEvent) => {
              if (event.key !== "Enter" && event.key !== " ") return
              arm()
            }}
            onPointerLeave={leave}
            onFocusOut={() => requestAnimationFrame(() => drop())}
          >
            {local.children}
          </Trigger>
          <Portal>
            <Content
              ref={(el) => {
                const theme = ref?.closest("[data-theme]")?.getAttribute("data-theme")

                if (theme) el.setAttribute("data-theme", theme)
              }}
              data-component="tooltip-v2"
              data-appearance={local.appearance ?? "compact"}
              data-placement={props.placement}
              data-force-open={local.forceOpen}
              data-instant={state.instant ? "" : undefined}
              class={local.contentClass}
              style={local.contentStyle}
              onPointerDownOutside={(e) => {
                if (ref === e.target || (e.target instanceof Node && ref?.contains(e.target))) {
                  justClickedTrigger = true
                }

                e.preventDefault()
              }}
            >
              {local.value}
            </Content>
          </Portal>
        </Root>
      </Match>
    </Switch>
  )
}

function container(trigger: HTMLElement, others: HTMLElement[]): HTMLElement | undefined {
  const parent = trigger.parentElement

  if (!parent) return

  if (others.every((other) => parent.contains(other))) return parent

  return container(parent, others)
}
