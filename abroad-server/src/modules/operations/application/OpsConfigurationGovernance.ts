import { ApplicationError } from '../../../core/errors'

export class OpsConfigurationReleaseRequiredError extends ApplicationError {
  public constructor() {
    super(
      409,
      'ops_configuration_release_required',
      'Direct configuration changes are disabled. Create and review a configuration release draft instead.',
    )
    this.name = 'OpsConfigurationReleaseRequiredError'
  }
}
