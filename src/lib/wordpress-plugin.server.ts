import { buildZip } from "./plugin-zip.server";

const VERSION = "1.0.0";

function php(origin: string, siteKey: string, greeting: string): string {
  return `<?php
/**
 * Plugin Name: Flash CRM Chat & Lead Capture
 * Description: Slide-in AI chatbot that collects WhatsApp numbers and emails, syncing every lead into Flash CRM.
 * Version: ${VERSION}
 * Author: Flash CRM
 * License: GPLv2 or later
 */

if (!defined('ABSPATH')) {
  exit;
}

define('FLAS_CRM_APP', '${origin}');
define('FLAS_CRM_VERSION', '${VERSION}');

function flas_crm_defaults() {
  return array(
    'site_key' => '${siteKey}',
    'greeting' => '${greeting.replace(/'/g, "\\'")}',
    'title'    => 'Chat with us',
    'accent'   => '#25D366',
    'brand'    => '#075E54',
    'admin_email' => get_option('admin_email'),
  );
}

function flas_crm_options() {
  $saved = get_option('flas_crm_options', array());
  return wp_parse_args(is_array($saved) ? $saved : array(), flas_crm_defaults());
}

/** Registers the popup script on the front end. */
function flas_crm_enqueue() {
  $options = flas_crm_options();
  if (empty($options['site_key'])) {
    return;
  }
  wp_enqueue_script(
    'flas-crm-popup',
    FLAS_CRM_APP . '/flas-popup.js',
    array(),
    FLAS_CRM_VERSION,
    true
  );
  $attributes = array(
    'data-site-key' => $options['site_key'],
    'data-title'    => $options['title'],
    'data-greeting' => $options['greeting'],
    'data-accent'   => $options['accent'],
    'data-brand'    => $options['brand'],
  );
  foreach ($attributes as $name => $value) {
    wp_script_add_data('flas-crm-popup', 'attribute_' . $name, $value);
  }
  add_filter('script_loader_tag', function ($tag, $handle) use ($attributes) {
    if ($handle !== 'flas-crm-popup') {
      return $tag;
    }
    $extra = '';
    foreach ($attributes as $name => $value) {
      $extra .= ' ' . esc_attr($name) . '="' . esc_attr($value) . '"';
    }
    return str_replace(' src=', $extra . ' src=', $tag);
  }, 10, 2);
}
add_action('wp_enqueue_scripts', 'flas_crm_enqueue');

/** Calls the Flash CRM activation endpoint so the workspace can approve this site. */
function flas_crm_request_activation() {
  $options = flas_crm_options();
  $response = wp_remote_post(FLAS_CRM_APP . '/api/public/plugin/activate', array(
    'timeout' => 15,
    'headers' => array('Content-Type' => 'application/json'),
    'body'    => wp_json_encode(array(
      'siteKey'    => $options['site_key'],
      'domain'     => home_url(),
      'adminEmail' => $options['admin_email'],
      'platform'   => 'wordpress',
    )),
  ));

  if (is_wp_error($response)) {
    update_option('flas_crm_status', array('state' => 'error', 'message' => $response->get_error_message()));
    return;
  }

  $body = json_decode(wp_remote_retrieve_body($response), true);
  update_option('flas_crm_status', array(
    'state'   => isset($body['status']) ? $body['status'] : 'pending',
    'message' => isset($body['message']) ? $body['message'] : '',
    'checked' => time(),
  ));
}

register_activation_hook(__FILE__, 'flas_crm_request_activation');

/** Settings screen. */
function flas_crm_menu() {
  add_options_page('Flash CRM', 'Flash CRM', 'manage_options', 'flas-crm', 'flas_crm_settings_page');
}
add_action('admin_menu', 'flas_crm_menu');

function flas_crm_settings_page() {
  if (!current_user_can('manage_options')) {
    return;
  }

  if (isset($_POST['flas_crm_nonce']) && wp_verify_nonce($_POST['flas_crm_nonce'], 'flas_crm_save')) {
    $options = flas_crm_options();
    $options['site_key']    = sanitize_text_field(wp_unslash($_POST['site_key'] ?? ''));
    $options['title']       = sanitize_text_field(wp_unslash($_POST['title'] ?? ''));
    $options['greeting']    = sanitize_textarea_field(wp_unslash($_POST['greeting'] ?? ''));
    $options['accent']      = sanitize_hex_color(wp_unslash($_POST['accent'] ?? '#25D366'));
    $options['brand']       = sanitize_hex_color(wp_unslash($_POST['brand'] ?? '#075E54'));
    $options['admin_email'] = sanitize_email(wp_unslash($_POST['admin_email'] ?? ''));
    update_option('flas_crm_options', $options);
    flas_crm_request_activation();
    echo '<div class="notice notice-success"><p>Saved. Activation request sent to Flash CRM.</p></div>';
  }

  $options = flas_crm_options();
  $status  = get_option('flas_crm_status', array('state' => 'unknown', 'message' => ''));
  ?>
  <div class="wrap">
    <h1>Flash CRM Chat &amp; Lead Capture</h1>
    <p>Status:
      <strong><?php echo esc_html($status['state']); ?></strong>
      <?php if (!empty($status['message'])) : ?>
        &mdash; <?php echo esc_html($status['message']); ?>
      <?php endif; ?>
    </p>
    <p>Activation is confirmed by email: check the inbox of the address below and click the activation link.</p>
    <form method="post">
      <?php wp_nonce_field('flas_crm_save', 'flas_crm_nonce'); ?>
      <table class="form-table" role="presentation">
        <tr><th scope="row"><label for="site_key">Site key</label></th>
          <td><input name="site_key" id="site_key" class="regular-text" value="<?php echo esc_attr($options['site_key']); ?>" /></td></tr>
        <tr><th scope="row"><label for="admin_email">Activation email</label></th>
          <td><input name="admin_email" id="admin_email" type="email" class="regular-text" value="<?php echo esc_attr($options['admin_email']); ?>" /></td></tr>
        <tr><th scope="row"><label for="title">Launcher title</label></th>
          <td><input name="title" id="title" class="regular-text" value="<?php echo esc_attr($options['title']); ?>" /></td></tr>
        <tr><th scope="row"><label for="greeting">Greeting</label></th>
          <td><textarea name="greeting" id="greeting" rows="3" class="large-text"><?php echo esc_textarea($options['greeting']); ?></textarea></td></tr>
        <tr><th scope="row"><label for="accent">Accent colour</label></th>
          <td><input name="accent" id="accent" value="<?php echo esc_attr($options['accent']); ?>" /></td></tr>
        <tr><th scope="row"><label for="brand">Header colour</label></th>
          <td><input name="brand" id="brand" value="<?php echo esc_attr($options['brand']); ?>" /></td></tr>
      </table>
      <?php submit_button('Save & request activation'); ?>
    </form>
  </div>
  <?php
}
`;
}

function readme(origin: string): string {
  return `=== Flash CRM Chat & Lead Capture ===
Requires at least: 5.6
Tested up to: 6.6
Stable tag: ${VERSION}
License: GPLv2 or later

== Description ==
Adds a slide-in AI chatbot to your WordPress site. Visitors leave their name,
WhatsApp number and email before chatting, and every lead lands in Flash CRM
where your team can reply on WhatsApp or by email.

== Installation ==
1. In WordPress go to Plugins > Add New > Upload Plugin and choose this ZIP.
2. Activate the plugin. It automatically asks Flash CRM to activate this site.
3. Open the activation email sent to your admin address and click the link.
4. Fine tune the launcher text and colours under Settings > Flash CRM.

Your workspace: ${origin}
`;
}

/** Builds the downloadable WordPress plugin archive for one connected site. */
export function buildWordPressPlugin(input: {
  origin: string;
  siteKey: string;
  greeting: string;
}): Uint8Array {
  return buildZip([
    { path: "flas-crm/flas-crm.php", content: php(input.origin, input.siteKey, input.greeting) },
    { path: "flas-crm/readme.txt", content: readme(input.origin) },
  ]);
}
