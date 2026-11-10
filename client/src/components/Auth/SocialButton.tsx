import { Button } from '@librechat/client';

const SocialButton = ({ id, enabled, serverDomain, oauthPath, Icon, label }) => {
  if (!enabled) {
    return null;
  }

  return (
    <div className="mt-2 flex gap-x-2">
      <Button
        asChild
        variant="outline"
        shape="soft"
        size="auth-action"
        className="w-full justify-start"
      >
        <a aria-label={`${label}`} href={`${serverDomain}/oauth/${oauthPath}`} data-testid={id}>
          <Icon />
          <span>{label}</span>
        </a>
      </Button>
    </div>
  );
};

export default SocialButton;
