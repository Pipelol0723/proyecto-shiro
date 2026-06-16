/**
 * Entry sintético para /design-sync (claude.ai/design).
 *
 * Re-exporta los componentes presentacionales de Shiro y arrastra el CSS de
 * los 3 temas + las fuentes como side-effect, para que el bundle
 * (`window.ShiroUI`) lleve el lenguaje visual completo. NO forma parte del
 * build de la app: solo lo consume el conversor de design-sync.
 *
 * Ver .design-sync/config.json (shape "package", entry apuntando aquí).
 */

// Side-effect: registra @fontsource + .theme-kawaii/.theme-cyber/.theme-editorial
// y las variables base. Sin esto el Orb se renderiza sin color de marca.
import '../packages/desktop/src/themes';

export { Orb } from '../packages/desktop/src/components/Orb/Orb';
export { ThemeSwitcher } from '../packages/desktop/src/components/ThemeSwitcher/ThemeSwitcher';
export {
  IconChat,
  IconModules,
  IconCharacter,
  IconAvatar,
  IconSetup,
  IconMic,
  IconSend,
} from '../packages/desktop/src/components/Icons/Icons';
