<script setup lang="ts">
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js"
import { Doughnut } from "vue-chartjs"

ChartJS.register(ArcElement, Tooltip, Legend)

const props = defineProps<{
  segments: { label: string; value: number; color: string }[]
}>()

const chartData = computed(() => {
  const active = props.segments.filter((s) => s.value > 0)
  const rows = active.length ? active : [{ label: "No orders", value: 1, color: "#E4D5C3" }]
  return {
    labels: rows.map((s) => s.label),
    datasets: [
      {
        data: rows.map((s) => s.value),
        backgroundColor: rows.map((s) => s.color),
        borderWidth: 0,
        hoverOffset: 6,
      },
    ],
  }
})

const options = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: "68%",
  plugins: {
    legend: {
      position: "bottom" as const,
      labels: { boxWidth: 10, usePointStyle: true, font: { size: 11, family: "DM Sans" }, padding: 14 },
    },
    tooltip: {
      backgroundColor: "#1A120E",
      padding: 10,
      cornerRadius: 8,
    },
  },
}

const total = computed(() => props.segments.reduce((a, s) => a + s.value, 0))
</script>

<template>
  <div class="relative h-full min-h-[220px]">
    <Doughnut :data="chartData" :options="options" />
    <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-8">
      <p class="text-[0.65rem] font-semibold uppercase tracking-wider text-[var(--muted)]">Pipeline</p>
      <p class="font-display text-2xl text-chocolate">{{ total }}</p>
    </div>
  </div>
</template>
