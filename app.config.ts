export default defineAppConfig({
  ui: {
    colors: {
      primary: "cocoa",
      secondary: "honey",
      success: "green",
      info: "sky",
      warning: "honey",
      error: "red",
      neutral: "stone",
    },
    button: {
      slots: {
        // Fixed 12px — matches old sc-btn (not Nuxt pill radii)
        base: "rounded-[12px] font-semibold shadow-sm",
        label: "truncate text-inherit",
      },
      defaultVariants: {
        size: "md",
        color: "primary",
        variant: "solid",
      },
      compoundVariants: [
        {
          color: "primary",
          variant: "solid",
          class:
            "!text-cream !bg-cocoa-500 hover:!bg-cocoa-600 active:!bg-cocoa-600 focus-visible:outline-cocoa-500/30",
        },
        {
          color: "primary",
          variant: "soft",
          class:
            "!text-chocolate !bg-honey/20 hover:!bg-honey/35 active:!bg-honey/35 focus-visible:outline-honey/40",
        },
        {
          color: "primary",
          variant: "outline",
          class:
            "ring-[var(--line)] !text-chocolate !bg-white/70 hover:!bg-cream focus-visible:outline-honey/40",
        },
        {
          color: "neutral",
          variant: "outline",
          class:
            "ring-[var(--line)] !text-chocolate !bg-white/70 hover:!bg-cream focus-visible:outline-honey/40",
        },
        {
          color: "neutral",
          variant: "ghost",
          // Light surfaces — chocolate text (sidebar overrides locally)
          class: "!text-chocolate hover:!bg-cream/80",
        },
        {
          color: "success",
          variant: "solid",
          class: "!text-cream !bg-success hover:!bg-success/90",
        },
        {
          color: "success",
          variant: "soft",
          class: "!text-success !bg-success/15 hover:!bg-success/25",
        },
      ],
    },
    card: {
      slots: {
        root: "rounded-[16px] overflow-hidden bg-[var(--surface)] ring-1 ring-[var(--line)] shadow-[0_10px_30px_-18px_rgba(42,26,18,0.35)] divide-y divide-[var(--line)]",
        header: "p-4 sm:px-6",
        title: "font-display text-xl text-chocolate font-semibold",
        description: "mt-1 text-sm text-[var(--muted)]",
        body: "p-4 sm:p-6",
        footer: "p-4 sm:px-6",
      },
      defaultVariants: {
        variant: "outline",
      },
    },
    input: {
      slots: {
        base: "rounded-[12px] font-sans",
      },
      variants: {
        variant: {
          outline:
            "bg-white text-chocolate ring-[var(--line)] placeholder:text-[var(--muted)] focus-visible:ring-2 focus-visible:ring-honey/40",
        },
      },
    },
    formField: {
      slots: {
        label: "text-xs font-semibold uppercase tracking-wide text-[var(--muted)]",
      },
    },
    badge: {
      slots: {
        base: "rounded-full font-semibold capitalize",
      },
    },
    tabs: {
      slots: {
        list: "rounded-[12px] bg-cream p-1",
        trigger:
          "rounded-[8px] font-semibold data-[state=active]:bg-surface data-[state=active]:text-chocolate data-[state=active]:shadow-sm",
      },
    },
    alert: {
      slots: {
        root: "rounded-[12px]",
      },
    },
    modal: {
      slots: {
        content: "rounded-[16px] bg-[var(--surface)] ring-[var(--line)]",
        title: "font-display text-xl text-chocolate",
        description: "text-[var(--muted)]",
      },
    },
  },
})
