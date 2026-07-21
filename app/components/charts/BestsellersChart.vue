<script setup lang="ts">
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js"
import { Bar } from "vue-chartjs"

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const props = defineProps<{
  items: { name: string; sales_count: number }[]
}>()

const chartData = computed(() => ({
  labels: props.items.map((p) => (p.name.length > 14 ? `${p.name.slice(0, 14)}…` : p.name)),
  datasets: [
    {
      label: "Units sold",
      data: props.items.map((p) => p.sales_count),
      backgroundColor: ["#C8971A", "#D4893A", "#5C4030", "#E8A87C", "#8B5E3C"],
      borderRadius: 8,
      barThickness: 28,
    },
  ],
}))

const options = {
  indexAxis: "y" as const,
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: { backgroundColor: "#1A120E", padding: 10, cornerRadius: 8 },
  },
  scales: {
    x: {
      grid: { color: "rgba(228,213,195,0.6)" },
      ticks: { font: { size: 11, family: "DM Sans" }, color: "#7A6A5A", stepSize: 1 },
      beginAtZero: true,
    },
    y: {
      grid: { display: false },
      ticks: { font: { size: 11, family: "DM Sans" }, color: "#3D2314" },
    },
  },
}
</script>

<template>
  <Bar :data="chartData" :options="options" />
</template>
