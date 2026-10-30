import DefaultTheme from 'vitepress/theme'
import { watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vitepress'
import mediumZoom from 'medium-zoom'
import './style.css'

export default {
  extends: DefaultTheme,
  setup() {
    const route = useRoute()
    let zoom
    const refresh = async () => {
      await nextTick()
      zoom?.detach()
      zoom?.attach('.vp-doc img:not(.no-zoom)')
    }
    onMounted(() => {
      zoom = mediumZoom({ background: 'rgba(0,0,0,.75)', margin: 24 })
      refresh()
    })
    watch(() => route.path, refresh)
    onUnmounted(() => zoom?.detach())
  },
}
