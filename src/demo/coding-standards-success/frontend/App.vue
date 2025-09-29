<template>
  <div class="app">
    <h1>Analyzer / Linter Demo</h1>
    <DemoItem v-for="(c,i) in customers" :key="i" :customer="c" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import DemoItem from './components/DemoItem.vue';
const customers = ref([{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }]);
</script>

<style scoped>
.app { padding: 1rem; font-family: system-ui, sans-serif; }
</style>
