import { Button } from '@librechat/client';
import { TStartupConfig } from 'librechat-data-provider';
import { policyUrls } from '~/utils/policies';
import { useLocalize } from '~/hooks';

function Footer({ startupConfig }: { startupConfig: TStartupConfig | null | undefined }) {
  const localize = useLocalize();
  if (!startupConfig) {
    return null;
  }
  /** Read the way the consent reads them, so a blank url is not a policy on one
   *  screen and a link back to this page on another. */
  const { privacyPolicyUrl, termsOfServiceUrl } = policyUrls(startupConfig);

  const privacyPolicyRender = privacyPolicyUrl != null && (
    <Button asChild variant="link-accent" size="bare">
      <a href={privacyPolicyUrl} rel="noreferrer">
        {localize('com_ui_privacy_policy')}
      </a>
    </Button>
  );

  const termsOfServiceRender = termsOfServiceUrl != null && (
    <Button asChild variant="link-accent" size="bare">
      <a href={termsOfServiceUrl} rel="noreferrer">
        {localize('com_ui_terms_of_service')}
      </a>
    </Button>
  );

  return (
    <div className="m-4 flex justify-center gap-2" role="contentinfo">
      {privacyPolicyRender}
      {privacyPolicyRender && termsOfServiceRender && (
        <div className="border-border-medium border-e" />
      )}
      {termsOfServiceRender}
    </div>
  );
}

export default Footer;
