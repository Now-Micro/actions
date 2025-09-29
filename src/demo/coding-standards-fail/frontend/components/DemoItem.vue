<template>
  <div class="demo-item">
    <strong>{{ customer.name }}</strong> (ID: {{ customer.id }})
  </div>
</template>

<script setup lang="ts">
interface Customer { id: number; name: string }
const props = defineProps<{ customer: Customer }>();
</script>

<style scoped>
.demo-item { margin: 0.25rem 0; }
</style>
