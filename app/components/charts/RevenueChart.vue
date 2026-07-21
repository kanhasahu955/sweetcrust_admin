<script setup lang="ts">
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from "chart.js"
import { Line } from "vue-chartjs"

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

const props = defineProps<{
  series: { date: string; revenue: number; orders: number }[]
}>()

const chartData = computed(() => ({
  labels: props.series.map((d) => {
    const parts = String(d.date).slice(5).split("-")
    return parts.length === 2 ? `${parts[1]}/${parts[0]}` : d.date
  }),
  datasets: [
    {
      label: "Revenue ₹",
      data: props.series.map((d) => d.revenue),
      borderColor: "#C8971A",
      backgroundColor: "rgba(200,151,26,0.18)",
      fill: true,
      tension: 0.35,
      pointRadius: 3,
      pointHoverRadius: 5,
      pointBackgroundColor: "#C8971A",
      borderWidth: 2.5,
    },
    {
      label: "Orders",
      data: props.series.map((d) => d.orders),
      borderColor: "#5C4030",
      backgroundColor: "transparent",
      tension: 0.35,
      pointRadius: 2,
      borderWidth: 2,
      yAxisID: "y1",
    },
  ],
}))

const options = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: "index" as const, intersect: false },
  plugins: {
    legend: {
      position: "top" as const,
      align: "end" as const,
      labels: { boxWidth: 10, usePointStyle: true, font: { size: 11, family: "DM Sans" } },
    },
    tooltip: {
      backgroundColor: "#1A120E",
      titleFont: { family: "DM Sans", size: 12 },
      bodyFont: { family: "DM Sans", size: 12 },
      padding: 10,
      cornerRadius: 8,
    },
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { font: { size: 11, family: "DM Sans" }, color: "#7A6A5A" },
    },
    y: {
      position: "left" as const,
      grid: { color: "rgba(228,213,195,0.7)" },
      ticks: {
        font: { size: 11, family: "DM Sans" },
        color: "#7A6A5A",
        callback: (v: string | number) => `₹${v}`,
      },
    },
    y1: {
      position: "right" as const,
      grid: { drawOnChartArea: false },
      ticks: { font: { size: 11, family: "DM Sans" }, color: "#7A6A5A", stepSize: 1 },
      beginAtZero: true,
    },
  },
}
</script>

<template>
  <Line :data="chartData" :options="options" />
</template>
